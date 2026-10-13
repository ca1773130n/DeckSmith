/**
 * What a scene needs read off its picture, at plan time: where a `region`'s
 * marks are, and the rows of an `evolve` trace printed only in a figure.
 *
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

type Lit = NonNullable<Storyboard["beats"][number]["literal"]>;

/** What one pass asks of a beat's panel. */
interface Ask<T> {
  /** The beats it asks about, with the picture beat and panel each runs on. */
  pick: (lit: Lit) => { picture: string; panel?: number } | undefined;
  schema: (lit: Lit) => object;
  prompt: (lit: Lit) => string;
  /** The reply read, or why it is no answer. */
  read: (reply: unknown, lit: Lit) => T | string;
  /** The refusal after two misses, from the beat's id and the last reason. */
  fail: (id: string, why: string) => string;
  /** Extra `-c` overrides for this pass's runs. */
  config?: readonly string[];
}

/**
 * Each picked beat's panel shown to the runner (`codex exec -i`), its answer
 * read: asked twice, then refused naming the beat. The panel is cut as the
 * build cuts it (`panelOf`), from the beat's OWN picture only: another beat's
 * illustration may not be drawn yet.
 */
async function askPanels<T>(
  storyboard: Storyboard,
  source: Source,
  assetsDir: string,
  ask: Ask<T>,
  opts: PassOpts,
): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  const todo = storyboard.beats.filter((b) => b.literal && ask.pick(b.literal));
  if (!todo.length) return found;
  const run = opts.run ?? runCodex;
  const config = opts.run ? [] : await leanCodexConfig();
  const dir = await mkdtemp(join(tmpdir(), "decksmith-look-"));
  try {
    for (const beat of todo) {
      const lit = beat.literal as Lit;
      const on = ask.pick(lit) as { picture: string; panel?: number };
      const owner = storyboard.beats.find((b) => b.id === on.picture);
      const fig = owner && source.figures.find((f) => f.id === figureOf(owner));
      if (!fig)
        throw new Error(`${beat.id}'s ${lit.kind} runs on "${on.picture}", which shows no figure`);
      opts.onBeat?.(beat.id);
      const panel = join(dir, `${beat.id}.png`);
      await writeFile(
        panel,
        pngOf(panelOf(await readFigure(resolve(assetsDir, fig.src)), on.panel)),
      );
      const schemaPath = join(dir, `${beat.id}.schema.json`);
      const outPath = join(dir, `${beat.id}.json`);
      await writeFile(schemaPath, JSON.stringify(ask.schema(lit)));
      let why = "";
      for (let attempt = 0; attempt < 2 && !found.has(beat.id); attempt++) {
        await rm(outPath, { force: true });
        await run({
          prompt: ask.prompt(lit),
          schemaPath,
          outPath,
          images: [panel],
          config: [...config, ...(ask.config ?? [])],
          ...(opts.model ? { model: opts.model } : {}),
          timeoutMs: 300_000,
        });
        const got = ask.read(JSON.parse(await readFile(outPath, "utf8").catch(() => "{}")), lit);
        if (typeof got === "string") why = got;
        else found.set(beat.id, got);
      }
      if (!found.has(beat.id)) throw new Error(ask.fail(beat.id, why));
    }
    return found;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface PassOpts {
  run?: Runner;
  model?: string;
  onBeat?: (id: string) => void;
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
  opts: PassOpts = {},
): Promise<Storyboard> {
  const found = await askPanels<Box[]>(
    storyboard,
    source,
    assetsDir,
    {
      pick: (l) =>
        l.kind === "region" && l.marks.length
          ? { picture: l.picture, ...(l.panel ? { panel: l.panel } : {}) }
          : undefined,
      schema: () => SCHEMA,
      prompt: (l) => locatePrompt(l.kind === "region" ? l.marks.map((m) => m.thing) : []),
      read: (reply, l) => readBoxes(reply, l.kind === "region" ? l.marks.length : 0),
      fail: (id, why) =>
        `locate: ${id}'s things were not found in its picture twice over (${why}). Name things the picture plainly shows, or the right \`panel\`.`,
    },
    opts,
  );
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
}

type Step = { lead?: string; parts: Array<{ text: string; tag: string }> };

/** The prompt for a trace: what to read, the tags, the rows exactly as printed. */
export function transcribePrompt(
  read: string,
  tags: ReadonlyArray<{ tag: string; label: string }>,
): string {
  return `This picture is a worked example from a paper. Read off it: ${read}

Transcribe it as rows, one per step, top to bottom, EXACTLY as printed: do not
correct, translate, complete or reorder anything.
- \`lead\`: the start of the row that only repeats what earlier rows already
  had, printed plain (unmarked, in the ordinary text colour). "" when there is none.
- \`parts\`: what this row ADDS after its lead, in order, each tagged with one
  of the tags below by how the picture marks it (its colour, a strike-through):
${tags.map((t) => `  - ${t.tag}: ${t.label}`).join("\n")}
  Consecutive words of one tag are one part. A struck-out piece is a part on its
  own; read the characters under the strike, not the strike.
Look at each row's colours closely: they are the point of the figure.`;
}

/** The rows a reply gives, or why it gives none. */
export function readSteps(reply: unknown, tags: readonly string[]): Step[] | string {
  const steps = (reply as { steps?: unknown })?.steps;
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 24)
    return `${Array.isArray(steps) ? steps.length : "no"} rows (2–24)`;
  const out: Step[] = [];
  for (const [i, st] of steps.entries()) {
    const parts = ((st as Step).parts ?? []).filter((q) => q.text?.trim());
    if (!parts.length) return `row ${i + 1} has no parts`;
    const bad = parts.find((q) => !tags.includes(q.tag));
    if (bad) return `row ${i + 1} tags "${bad.text}" with "${bad.tag}"`;
    const lead = (st as Step).lead?.trim();
    out.push({
      ...(lead ? { lead } : {}),
      parts: parts.map((q) => ({ text: q.text.trim(), tag: q.tag })),
    });
  }
  return out;
}

/**
 * The storyboard with every figure `trace`'s rows transcribed from its panel.
 * The steps are the figure's, so the truth gate does not hold their numbers to
 * the prose (src/plan/coverage.ts); what no gate sees is a misread glyph.
 */
export async function transcribeTraces(
  storyboard: Storyboard,
  source: Source,
  assetsDir: string,
  opts: PassOpts = {},
): Promise<Storyboard> {
  const tagsOf = (l: Lit) => (l.kind === "evolve" ? l.tags : []);
  const found = await askPanels<Step[]>(
    storyboard,
    source,
    assetsDir,
    {
      pick: (l) =>
        l.kind === "evolve" && l.rule === "trace" && l.picture
          ? { picture: l.picture, ...(l.panel ? { panel: l.panel } : {}) }
          : undefined,
      schema: (l) => ({
        type: "object",
        additionalProperties: false,
        required: ["steps"],
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["lead", "parts"],
              properties: {
                lead: { type: "string" },
                parts: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["text", "tag"],
                    properties: {
                      text: { type: "string" },
                      tag: { type: "string", enum: tagsOf(l).map((t) => t.tag) },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prompt: (l) =>
        transcribePrompt(l.kind === "evolve" ? (l.read ?? "the trace") : "", tagsOf(l)),
      read: (reply, l) =>
        readSteps(
          reply,
          tagsOf(l).map((t) => t.tag),
        ),
      // MEASURED 2026-10-13 on a nine-row decoding trace: at the default effort 4
      // of 9 rows came back right (colours confused, strikes read as "-5", a "7"
      // invented); at high effort 8 of 9, in 46s against 9s.
      config: ['model_reasoning_effort="high"'],
      fail: (id, why) =>
        `transcribe: ${id}'s trace could not be read off its picture twice over (${why}). Say plainly what to \`read\`, or name the right \`panel\`.`,
    },
    opts,
  );
  return {
    ...storyboard,
    beats: storyboard.beats.map((b) => {
      const steps = found.get(b.id);
      if (!steps || b.literal?.kind !== "evolve") return b;
      return { ...b, literal: { ...b.literal, steps } };
    }),
  };
}
