/**
 * Where a `region`'s marks are. The planner never sees a figure's pixels, so it
 * names each `thing` and this pass finds it: Codex is shown the ONE panel the
 * scene shows (`codex exec -i`, the panel cut as the build cuts it, `panelOf`)
 * and returns a box per thing, written into the storyboard as fractions of that
 * panel. The build then draws what the storyboard holds, offline.
 *
 * MEASURED 2026-10-13 on OneVL's driving frames: 11 of 11 things boxed on their
 * object when shown a single panel, 0 of 3 when shown the whole four-panel
 * figure (every box shifted off its object) — hence the panel. One run in five
 * came back with no boxes at all: asked twice, then refused, naming the beat.
 *
 * What no check here can see is a box on the WRONG object of the right size.
 * The frames are where that shows; look at them.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodePng } from "../bespoke/inspect.js";
import { figureOf } from "../literal/index.js";
import { panelOf, readFigure } from "../literal/kinds/region.js";
import type { Rgb } from "../literal/kit.js";
import type { Source, Storyboard } from "../types.js";
import { leanCodexConfig, type Runner, runCodex } from "./codex.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["marks"],
  properties: {
    marks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["thing", "x", "y", "w", "h"],
        properties: {
          thing: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
      },
    },
  },
};

type Box = { x: number; y: number; w: number; h: number };

/** The prompt for one panel: its things, numbered, one tight box each. */
export function locatePrompt(things: readonly string[]): string {
  return `Find each of these things in the picture:
${things.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return one entry per thing, in this order, with \`thing\` as given. Give a TIGHT
box around each, as fractions of the picture's width and height: x,y = top-left
corner, w,h = size, all in 0..1. Look carefully: the boxes are drawn on the
picture as-is.`;
}

/** The boxes a reply gives, in order, or why it gives none. */
export function readBoxes(reply: unknown, n: number): Box[] | string {
  const marks = (reply as { marks?: unknown })?.marks;
  if (!Array.isArray(marks) || marks.length !== n)
    return `${Array.isArray(marks) ? marks.length : "no"} boxes for ${n} things`;
  const out: Box[] = [];
  for (const [i, m] of marks.entries()) {
    const { x, y, w, h } = m as Box;
    if (![x, y, w, h].every(Number.isFinite) || w < 0.003 || h < 0.003)
      return `thing ${i + 1} has no box`;
    // A box a hair past the edge is the edge; one well past it is no box.
    if (x < -0.02 || y < -0.02 || x + w > 1.02 || y + h > 1.02)
      return `thing ${i + 1}'s box runs outside the picture`;
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const r = (v: number) => Math.round(v * 1e4) / 1e4;
    out.push({
      x: r(x0),
      y: r(y0),
      w: r(Math.min(1, x + w) - x0),
      h: r(Math.min(1, y + h) - y0),
    });
  }
  return out;
}

function pngOf(img: Rgb): Buffer {
  const pixels = new Uint8Array(img.w * img.h * 3);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = Math.round(Math.max(0, Math.min(1, img.d[i] as number)) * 255);
  return encodePng({ width: img.w, height: img.h, channels: 3, pixels });
}

/**
 * The storyboard with every marked `region`'s boxes found (any box the planner
 * wrote is a guess and is replaced). Fails loudly, naming the beat, when a
 * panel's things cannot be found twice over.
 */
export async function locateMarks(
  storyboard: Storyboard,
  source: Source,
  assetsDir: string,
  opts: { run?: Runner; model?: string; onBeat?: (id: string) => void } = {},
): Promise<Storyboard> {
  const todo = storyboard.beats.filter(
    (b) => b.literal?.kind === "region" && !b.literal.cut && b.literal.marks.length,
  );
  if (!todo.length) return storyboard;
  const run = opts.run ?? runCodex;
  const config = opts.run ? [] : await leanCodexConfig();
  const dir = await mkdtemp(join(tmpdir(), "decksmith-locate-"));
  try {
    const found = new Map<string, Box[]>();
    for (const beat of todo) {
      const lit = beat.literal as Extract<NonNullable<typeof beat.literal>, { kind: "region" }>;
      // Only this beat's own picture: another beat's illustration may not be drawn yet.
      const owner = storyboard.beats.find((b) => b.id === lit.picture);
      const fig = owner && source.figures.find((f) => f.id === figureOf(owner));
      if (!fig)
        throw new Error(
          `locate: ${beat.id}'s region runs on "${lit.picture}", which shows no figure`,
        );
      const file = resolve(assetsDir, fig.src);
      opts.onBeat?.(beat.id);
      const panel = join(dir, `${beat.id}.png`);
      await writeFile(panel, pngOf(panelOf(await readFigure(file), lit.panel)));
      const schemaPath = join(dir, "marks.schema.json");
      const outPath = join(dir, `${beat.id}.json`);
      await writeFile(schemaPath, JSON.stringify(SCHEMA));
      let why = "";
      for (let attempt = 0; attempt < 2 && !found.has(beat.id); attempt++) {
        await rm(outPath, { force: true });
        await run({
          prompt: locatePrompt(lit.marks.map((m) => m.thing)),
          schemaPath,
          outPath,
          images: [panel],
          config,
          ...(opts.model ? { model: opts.model } : {}),
          timeoutMs: 300_000,
        });
        const boxes = readBoxes(
          JSON.parse(await readFile(outPath, "utf8").catch(() => "{}")),
          lit.marks.length,
        );
        if (typeof boxes === "string") why = boxes;
        else found.set(beat.id, boxes);
      }
      if (!found.has(beat.id))
        throw new Error(
          `locate: ${beat.id}'s things were not found in its picture twice over (${why}). Name things the picture plainly shows, or the right \`panel\`.`,
        );
    }
    return {
      ...storyboard,
      beats: storyboard.beats.map((b) => {
        const boxes = found.get(b.id);
        if (!boxes || b.literal?.kind !== "region") return b;
        return {
          ...b,
          literal: {
            ...b.literal,
            marks: b.literal.marks.map((m, i) => ({ ...m, box: boxes[i] as Box })),
          },
        };
      }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
