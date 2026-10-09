/**
 * An animate piece, from the author's file to the frame its plugin draws.
 *
 * `assemblePiece` (src/build/piece.ts) wraps the author's scene file with the
 * vendored kit; `copyAssets` writes that into the deck; the runtime
 * (src/emit/animate-runtime.ts) mounts it and draws it from the `dsAnimate`
 * plugin. Here the REAL assembled kit runs in a node `vm` against a canvas that
 * accepts every 2D call and draws nothing — no browser, so this proves which
 * FRAME the kit is asked for, not what it paints. The spike rendered and
 * watched the paint (.planning/2026-10-09-animate-piece-spike.md).
 *
 * The last block does open a browser: it builds a deck with the CLI, holds the
 * frame memo to the pixels, and runs `decksmith verify` on a piece that throws
 * while drawing, one that throws while loading, and one that writes text on
 * its offscreen layer — the three failures the spike found every gate passing.
 * It also opens the deck in a browser with no WebGL, which once refused every
 * piece and so skipped the fidelity gate.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { copyAssets } from "../src/build/files.js";
import { assemblePiece } from "../src/build/piece.js";
import {
  DSAnimatePlugin,
  mount,
  PIECE_ATTR,
  pieces,
  pieceTime,
  sweep,
} from "../src/emit/animate-runtime.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import { resolveTheme } from "../src/emit/theme.js";
import { captureFrames, chromePath, type DeckPage, openDeck } from "../src/render/capture.js";
import { beatSchema, FORMATS, type Format, sourceSchema } from "../src/types.js";
import { fidelity } from "../src/verify/fidelity.js";
import { scanDeterminism } from "../src/verify/index.js";

/** Accepts any property read, call or arithmetic, and is always itself. */
const ANY: unknown = new Proxy(() => {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : ANY),
  apply: () => ANY,
  set: () => true,
});

/**
 * Stands in for the browser's `CanvasRenderingContext2D`, so the runtime's text
 * trap has a prototype to swap — node has none. Its own text methods draw
 * nothing and succeed, as the real ones do outside a piece.
 */
class Ctx2D {
  fillText(): void {}
  strokeText(): void {}
}

/** A canvas whose 2D context records what is assigned to it and no-ops the rest. */
function fakeCanvas(id = "s2-pc", width = 1920, height = 1080) {
  const own = Object.create(Ctx2D.prototype) as Record<PropertyKey, unknown>;
  const ctx = new Proxy(own, {
    get: (t, k) => (k in t ? t[k] : ANY),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
  return { id, width, height, ctx, getContext: () => ctx } as unknown as HTMLCanvasElement & {
    ctx: Record<string, unknown>;
  };
}

/**
 * The smallest piece an author could write: one era, one shot, one cut-paper
 * shape — and a line that records the frame morph.js chose, which is what the
 * clamp is about.
 */
const AUTHOR = `const ERA_BG = ['#cfe2ee'];
function pieceCam(era, t) { return null; }
const ERA_LIST = [[0, DURATION, () => sceneOnly()]];
const SHOTS = [['only', 0, 0.0, DURATION, 'one shot']];
const BRIDGES = [];
function sceneOnly() {
  window.__frames.push(F);
  cut(rect(LX(0.2 + 0.5 * TT / DURATION), LY(0.2), 200 * UNIT, 200 * UNIT, 8), PAL.orange, { key: 'box' });
}
`;

/** Run an assembled piece the way the deck's `<script src>` does, into `pieces`. */
function load(script: string): number[] {
  const frames: number[] = [];
  const sandbox: Record<string, unknown> = {
    DSAnimate: { pieces, mount },
    __frames: frames,
    document: { createElement: () => fakeCanvas("layer") },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(script, sandbox);
  return frames;
}

describe("assemblePiece", () => {
  it("wraps the author's file in the kit, under the figure's id, with the MIT notice", async () => {
    const out = await assemblePiece("fig-loop", "pieces/loop.js", AUTHOR);

    expect(out.startsWith("// pieces/loop.js — an animate piece, assembled by DeckSmith")).toBe(
      true,
    );
    expect(out).toContain("//   Copyright (c) 2026 cth9191");
    expect(out).toContain('window.DSAnimate.pieces["fig-loop"] = function (cfg) {');
    // animate's own build order: core, style, the author's scenes, morph.
    const at = (s: string) => out.indexOf(s);
    expect(at("// ==== animate kit/core.js")).toBeGreaterThan(0);
    expect(at("// ==== animate kit/cut-paper.js")).toBeGreaterThan(at("kit/core.js"));
    expect(at("// ==== pieces/loop.js")).toBeGreaterThan(at("kit/cut-paper.js"));
    expect(at("// ==== animate kit/morph.js")).toBeGreaterThan(at("// ==== pieces/loop.js"));
    // Same input, same bytes — or two builds of one deck differ.
    expect(await assemblePiece("fig-loop", "pieces/loop.js", AUTHOR)).toBe(out);
  });

  it("passes the determinism scan: the kit seeds its own RNG and reads no clock", async () => {
    expect(scanDeterminism(await assemblePiece("p", "p.js", AUTHOR), "assets/p.js")).toEqual([]);
  });

  /**
   * `handwrite` draws letters as ink strokes, which no runtime trap can tell
   * from a line, so the type floor never sees them. The author file is in hand
   * here, so a call by name is refused at build.
   */
  it("refuses a piece that calls handwrite, naming the line", async () => {
    const texty = AUTHOR.replace(
      "const BRIDGES = [];",
      "const BRIDGES = [];\nhandwrite('hi', 10, 10, 30);",
    );
    await expect(assemblePiece("p", "pieces/p.js", texty)).rejects.toThrow(
      /pieces\/p.js:6 calls handwrite — it draws text as strokes the 40px type floor never reads/,
    );
  });
});

describe("the dsAnimate plugin", () => {
  /** Mount a fresh copy of a fixture piece and return what a tween needs. */
  async function mounted(id: string, seconds: number, author = AUTHOR) {
    const frames = load(await assemblePiece(id, `${id}.js`, author));
    const canvas = fakeCanvas(`${id}-pc`);
    mount(canvas, id, { seconds, fps: 30, hand: '"Inter", sans-serif' });
    const state = {} as Parameters<typeof DSAnimatePlugin.render>[1];
    DSAnimatePlugin.init.call(state, canvas, seconds);
    return { frames, canvas, state };
  }

  /** What the page would have reported as uncaught. */
  let reported: unknown[] = [];
  beforeEach(() => {
    reported = [];
    vi.stubGlobal("CanvasRenderingContext2D", Ctx2D);
    vi.stubGlobal("reportError", (e: unknown) => reported.push(e));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * THE LAST-FRAME CLAMP. The tween's value is the piece's own second, so at
   * ratio 1 it is `seconds` exactly — frame `round(4 * 30)` = 120 of a 120-frame
   * piece, which morph.js's `% NFRAMES` wraps to frame 0. Unclamped, the hold
   * after the piece would show its FIRST pose. This runs the real morph.js.
   */
  it("ends on the piece's last frame, not on its first", async () => {
    const { frames, state } = await mounted("clamp", 4);

    DSAnimatePlugin.render(1, state);
    expect(frames.at(-1)).toBe(119);
    // Without the clamp, the same arithmetic morph.js does lands on 0.
    expect(Math.round(4 * 30) % 120).toBe(0);
    expect(pieceTime(4, { n: 120, fps: 30 })).toBe(119 / 30);
  });

  it("draws piece time ratio x seconds, and seeking back draws the earlier frame again", async () => {
    const { frames, state } = await mounted("seek", 4);

    for (const r of [0, 0.5, 0.25, 0.5, 0]) DSAnimatePlugin.render(r, state);
    expect(frames.slice(-5)).toEqual([0, 60, 30, 60, 0]);
  });

  /**
   * ONE DRAW PER FRAME. hyperframes seeks each captured frame three times —
   * `N`, `N + .001`, `N` — and every one used to repaint the whole piece. The
   * seek-back above still draws: only a repeat of the frame ALREADY on the
   * canvas is skipped. The browser test below holds the pixels to it.
   */
  it("draws a frame once however many times it is seeked to, and any other frame at once", async () => {
    const { frames, state } = await mounted("memo", 4);
    const at = (s: number) => DSAnimatePlugin.render(s / 4, state);

    for (const s of [2, 2.001, 2]) at(s);
    expect(frames).toEqual([60]);
    for (const s of [2.034, 2.034, 2]) at(s);
    expect(frames).toEqual([60, 61, 60]);
  });

  /**
   * A DRAWING ERROR IS A PAGE ERROR. Under hyperframes the rethrow lands in a
   * `catch` that tells no one, so `reportError` is what the gate sees; the
   * browser test below runs `decksmith verify` on it. A draw that threw leaves
   * the canvas half-painted, so it forgets what was drawn before: the failed
   * frame is tried — and reported — again, and so is the frame before it.
   */
  it("reports a drawing error as uncaught, rethrows it, and does not memo the frame", async () => {
    const bad = AUTHOR.replace(
      "window.__frames.push(F);",
      "window.__frames.push(F); if (F >= 60) STYLE.missing(ctx);",
    );
    const { frames, state } = await mounted("throws", 4, bad);

    DSAnimatePlugin.render(0.25, state);
    expect(reported).toEqual([]);
    expect(() => DSAnimatePlugin.render(0.5, state)).toThrow(/STYLE.missing is not a function/);
    expect(() => DSAnimatePlugin.render(0.5, state)).toThrow(/STYLE.missing is not a function/);
    expect(reported.map(String)).toEqual([
      expect.stringMatching(/STYLE.missing is not a function/),
      expect.stringMatching(/STYLE.missing is not a function/),
    ]);
    // The canvas now holds half of frame 60, so frame 30 is not "still there".
    DSAnimatePlugin.render(0.25, state);
    expect(frames).toEqual([30, 60, 60, 30]);
  });

  /**
   * A throw in ONE frame is a page error only if something seeks to that frame,
   * and `check` samples a long deck coarsely. `sweep` draws every frame once,
   * on a scratch canvas, for `fidelity` to fail on — leaving the deck's canvas
   * and its frame memo alone, and reporting nothing to the page itself.
   */
  it("sweeps every frame off the deck's canvas, and finds a throw confined to one", async () => {
    vi.stubGlobal("document", { createElement: () => fakeCanvas("scratch") });
    const bad = AUTHOR.replace(
      "window.__frames.push(F);",
      "window.__frames.push(F); if (F === 75) STYLE.missing(ctx);",
    );
    const { frames, state } = await mounted("window", 4, bad);
    DSAnimatePlugin.render(0.5, state);
    const drawn = frames.length;

    expect(sweep().filter((b) => b.id === "window")).toEqual([
      {
        id: "window",
        frames: [75],
        message: expect.stringMatching(/STYLE.missing is not a function/),
      },
    ]);
    expect(frames.slice(drawn)).toEqual(Array.from({ length: 120 }, (_, i) => i));
    expect(reported).toEqual([]);
    // Frame 60 is still what the deck's canvas holds, so it is not drawn again.
    DSAnimatePlugin.render(0.5, state);
    expect(frames).toHaveLength(drawn + 120);
  });

  /**
   * NO TEXT FROM A PIECE, on the canvas the piece made for itself. morph.js
   * draws every era on `layer(0)`, an offscreen canvas the mounted-canvas trap
   * the spike tested never saw. `handText` is cut-paper's own primitive.
   */
  it("refuses text on the offscreen layer too, and only while the piece draws", async () => {
    const texty = AUTHOR.replace(
      "window.__frames.push(F);",
      "window.__frames.push(F); handText('hi', 100, 100, 40, PAL.ink);",
    );
    const { canvas, state } = await mounted("text", 2, texty);
    const own = Ctx2D.prototype.fillText;

    expect(() => DSAnimatePlugin.render(0.5, state)).toThrow(
      /piece "text" called fillText — a piece draws no text \(invariant 5\)/,
    );
    expect(reported).toHaveLength(1);
    // Restored the moment the draw ends: the page's other canvases write text.
    const ctx = canvas.getContext("2d") as unknown as Ctx2D;
    expect(() => ctx.fillText()).not.toThrow();
    expect(Ctx2D.prototype.fillText).toBe(own);
    expect(Object.hasOwn(ctx, "fillText")).toBe(false);
  });

  /**
   * A literal end shorter than the figure's `seconds`: morph.js's `eraAt` finds
   * no era past 3s and falls back to era 0, so the rest of the tween and the
   * whole hold would replay the opening scene with no error anywhere.
   */
  it.each([
    ["ERA_LIST", AUTHOR.replace("[[0, DURATION, () =>", "[[0, 3, () =>"), "ERA_LIST ends at 3s"],
    [
      "SHOTS",
      AUTHOR.replace("0.0, DURATION, 'one shot'", "0.0, 3, 'one shot'"),
      "SHOTS ends at 3s",
    ],
  ])("refuses a piece whose %s ends before the figure does", async (_list, author, said) => {
    load(await assemblePiece("ends", "ends.js", author));
    expect(() =>
      mount(fakeCanvas("ends-pc"), "ends", { seconds: 4, fps: 30, hand: "serif" }),
    ).toThrow(`piece "ends": ${said} and the figure plays 4s — end its last entry at DURATION`);
  });

  it("refuses, by name, a piece whose script never ran and a canvas nothing mounted", () => {
    expect(() => mount(fakeCanvas(), "nobody", { seconds: 1, fps: 30, hand: "serif" })).toThrow(
      /no piece registered as "nobody" — its <script src> did not run/,
    );
    expect(() => mount(null, "nobody", { seconds: 1, fps: 30, hand: "serif" })).toThrow(
      /no canvas for piece "nobody"/,
    );
    expect(() => DSAnimatePlugin.init.call({} as never, fakeCanvas("s9-pc"), 1)).toThrow(
      /nothing mounted on #s9-pc; DSAnimate.mount must run in measure/,
    );
  });
});

/**
 * THE SWEEP HOLDS A PIECE. Design §5 makes `npm run sweep` the receipt for this
 * src/ change, and the sweep takes its figures from demo/, which has no piece:
 * its receipt never built a canvas, a plate cap or a `dsAnimate` hold. The
 * corpus brings its own.
 */
describe("the perturbation sweep's corpus", () => {
  it("builds a piece on claim-figure at every level of its axis, one per deck", async () => {
    type Cell = { beatId: string; level: number };
    type Fig = { id: string; kind?: string };
    const corpus = (await import(
      new URL("../scripts/sweep-perturbations.mjs", import.meta.url).href
    )) as {
      CELLS: Cell[];
      deckBeat: (cell: Cell, src: { figures: Fig[] }, core: object) => Record<string, unknown>;
      PIECE_SRC: string;
      PIECE_AUTHOR: string;
    };
    const demo = readFileSync(new URL("../demo/source.json", import.meta.url), "utf8");
    const core = { intent: "the perturbation sweep", evidence: [], weight: 1, seconds: 9 };

    const levels: number[] = [];
    for (const cell of corpus.CELLS) {
      const src = JSON.parse(demo) as { figures: Fig[] };
      const beat = corpus.deckBeat(cell, src, core);
      const pieceIds = src.figures.filter((f) => f.kind === "piece").map((f) => f.id);
      if (pieceIds.length === 0) continue;
      expect(pieceIds).toHaveLength(1);
      levels.push(cell.level);
      const scene = emitScene(beatSchema.parse(beat), {
        source: sourceSchema.parse(src),
        format: FORMATS["deck-16x9"] as Format,
        theme: resolveTheme("ink"),
        sid: "s2",
        start: 0,
      });
      expect(scene.html).toContain(`<canvas id="s2-pc" ${PIECE_ATTR}`);
      expect(scene.plugins).toEqual(["dsAnimate"]);
    }
    expect(levels).toEqual([0, 1, 2]);

    // The file the sweep writes passes the build's own refusals and mounts.
    load(await assemblePiece("fig-piece", corpus.PIECE_SRC, corpus.PIECE_AUTHOR));
    expect(() =>
      mount(fakeCanvas("s2-pc"), "fig-piece", { seconds: 4, fps: 30, hand: "serif" }),
    ).not.toThrow();
  });
});

describe("copyAssets", () => {
  it("writes a piece ASSEMBLED under its own name, and copies an image as it is", async () => {
    const root = mkdtempSync(join(tmpdir(), "piece-assets-"));
    mkdirSync(join(root, "src", "assets", "pieces"), { recursive: true });
    writeFileSync(join(root, "src", "assets", "pieces", "loop.js"), AUTHOR);
    writeFileSync(join(root, "src", "assets", "still.png"), "png bytes");
    const out = join(root, "deck");

    await copyAssets(
      join(root, "src"),
      out,
      [
        { id: "fig-loop", kind: "piece", src: "pieces/loop.js" },
        { id: "fig-still", kind: "image", src: "still.png" },
      ],
      () => {},
    );

    expect(readFileSync(join(out, "assets", "pieces", "loop.js"), "utf8")).toBe(
      await assemblePiece("fig-loop", "pieces/loop.js", AUTHOR),
    );
    expect(readFileSync(join(out, "assets", "still.png"), "utf8")).toBe("png bytes");
  });

  /**
   * The file a piece names is written as THAT piece's script. Two pieces on one
   * file used to register only the last, and `mount` blamed the `<script src>`;
   * an image on it drew JavaScript as a picture.
   */
  it.each([
    ["another piece", { id: "fig-b", kind: "piece", src: "./pieces/loop.js" }],
    ["an image", { id: "fig-b", kind: "image", src: "pieces/loop.js" }],
    ["a clip's poster", { id: "fig-b", kind: "clip", src: "c.mp4", poster: "pieces/loop.js" }],
  ])("refuses a piece's file shared with %s, naming both figures", async (_what, other) => {
    const root = mkdtempSync(join(tmpdir(), "piece-shared-"));
    mkdirSync(join(root, "src", "assets", "pieces"), { recursive: true });
    writeFileSync(join(root, "src", "assets", "pieces", "loop.js"), AUTHOR);

    await expect(
      copyAssets(
        join(root, "src"),
        join(root, "deck"),
        [{ id: "fig-a", kind: "piece", src: "pieces/loop.js" }, other],
        () => {},
      ),
    ).rejects.toThrow(/build: figures "fig-[ab]" and "fig-[ab]" both use "\.?\/?pieces\/loop.js"/);
  });
});

/**
 * THE BROWSER, the gate and the build — each the one a reader runs. Needs
 * `dist/cli.js` and the renderer's Chrome; skipped without either, as
 * test/narration-canvas.test.ts and test/deck-page.test.ts are — EXCEPT where
 * `DECKSMITH_REQUIRE_BROWSER=1`, which CI's demo job sets so that a missing
 * dist or Chrome fails there instead of skipping (`npm test` in the check job
 * runs before `npm run build`, with no browser, so it always skips).
 *
 * A dist/ OLDER THAN src/ FAILS. These tests build and gate decks with
 * `dist/cli.js` while the pieces in them are assembled from src/, so a stale
 * dist measures neither version.
 */
const run = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const built = await stat(cli).then(
  () => true,
  () => false,
);
const chrome = await chromePath("open a piece with").catch(() => null);
const required = process.env.DECKSMITH_REQUIRE_BROWSER === "1";

/** The newest file under src/ that is newer than the dist/ bundles, if any. */
async function staleAgainst(): Promise<string | undefined> {
  const dist = await Promise.all(
    ["cli.js", "ds-animate.js"].map((f) =>
      stat(fileURLToPath(new URL(`../dist/${f}`, import.meta.url))).then(
        (s) => s.mtimeMs,
        () => 0,
      ),
    ),
  );
  const oldest = Math.min(...dist);
  const src = fileURLToPath(new URL("../src", import.meta.url));
  for (const e of await readdir(src, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const at = join(e.parentPath, e.name);
    if ((await stat(at)).mtimeMs > oldest) return at;
  }
  return undefined;
}

/** The fixture piece, minus the line that records frames into a node array. */
const PIECE = AUTHOR.replace("  window.__frames.push(F);\n", "");

describe.skipIf(!required && (!built || chrome === null))("a piece in a built deck", () => {
  let dir = "";
  let deck = "";

  beforeAll(async () => {
    if (!built) throw new Error(`${cli} is missing — run \`npm run build\``);
    if (chrome === null) throw new Error("no Chrome — run `npx hyperframes browser ensure`");
    const newer = await staleAgainst();
    if (newer) throw new Error(`dist/ is older than ${newer} — run \`npm run build\``);
    dir = await mkdtemp(join(tmpdir(), "decksmith-piece-"));
    deck = join(dir, "deck");
    await mkdir(join(dir, "assets", "pieces"), { recursive: true });
    await writeFile(join(dir, "assets", "pieces", "loop.js"), PIECE);
    await writeFile(
      join(dir, "source.json"),
      JSON.stringify({
        id: "src-piece",
        title: "A piece",
        lang: "en",
        sections: [{ id: "sec-1", depth: 1, heading: "One", text: "A loop." }],
        figures: [
          {
            id: "fig-loop",
            kind: "piece",
            src: "pieces/loop.js",
            caption: "A box on paper",
            width: 1920,
            height: 1080,
            seconds: 4,
          },
        ],
        equations: [],
        tables: [],
      }),
    );
    await writeFile(
      join(dir, "storyboard.json"),
      JSON.stringify({
        sourceId: "src-piece",
        title: "A piece",
        beats: [
          {
            id: "b1",
            intent: "Open.",
            archetype: "title",
            seconds: 3,
            params: { headline: "A piece" },
          },
          {
            id: "b2",
            intent: "Show it.",
            archetype: "claim-figure",
            seconds: 6,
            params: { headline: "It moves", claim: "The box crosses.", figureId: "fig-loop" },
          },
        ],
      }),
    );
    // The control: the same deck, unbroken, passes the same gates.
    const { stdout } = await run(process.execPath, [
      cli,
      "build",
      join(dir, "storyboard.json"),
      "--source",
      join(dir, "source.json"),
      "-o",
      deck,
      "--no-narration",
      "--no-fidelity",
    ]);
    expect(stdout).toMatch(/^PASS — 0 error\(s\)/m);
  }, 300_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** The deck above, its piece re-assembled from `author`, under a directory named for `name`. */
  async function brokenCopy(name: string, author: string): Promise<string> {
    const broken = join(dir, `broken-${name.replace(/\W+/g, "-")}`);
    await cp(deck, broken, { recursive: true });
    await writeFile(
      join(broken, "assets", "pieces", "loop.js"),
      await assemblePiece("fig-loop", "pieces/loop.js", author),
    );
    return broken;
  }

  /**
   * ONE DRAW PER FRAME, held to the pixels. `renderSeek(t)` with no options is
   * the render's path, the one that moves the timeline three times per frame.
   * Draws are counted on the mounted canvas: morph.js asks it for its context
   * once per `renderFrame`. The piece runs 4.0s–8.0s in the deck.
   *
   * The gate's own path (`suppressEvents`) is seeked FROM ANOTHER FRAME: a
   * seek to the frame already on the canvas draws nothing, so its pixels would
   * be the previous seek's whatever the gate path painted.
   */
  it("draws each frame once on the render path, and seeking back repaints the same pixels", async () => {
    let page: DeckPage | undefined;
    try {
      page = await openDeck(deck);
      await page.page.waitForFunction("window.__hfTimelinesBuilding === false");
      const got = await page.page.evaluate(() => {
        const w = window as unknown as {
          __player: { renderSeek: (t: number, o?: { suppressEvents: boolean }) => void };
        };
        const cv = document.getElementById("s2-pc") as HTMLCanvasElement;
        const own = cv.getContext.bind(cv);
        let draws = 0;
        cv.getContext = ((...a: Parameters<typeof own>) => {
          draws++;
          return own(...a);
        }) as typeof cv.getContext;
        const at = (t: number, o?: { suppressEvents: boolean }) => {
          draws = 0;
          w.__player.renderSeek(t, o);
          return { draws, px: cv.toDataURL() };
        };
        return {
          first: at(6),
          again: at(6),
          // Frame times exactly: the runtime floors a seek to its frame.
          next: [at(181 / 30), at(182 / 30)],
          away: at(7.5),
          back: at(6),
          left: at(7.5),
          gate: at(6, { suppressEvents: true }),
        };
      });

      expect(got.first.draws).toBe(1);
      expect(got.again.draws).toBe(0);
      expect(got.next.map((s) => s.draws)).toEqual([1, 1]);
      expect(got.away.draws).toBe(1);
      expect(got.back.draws).toBe(1);
      expect(got.away.px).not.toBe(got.first.px);
      expect(got.back.px).toBe(got.first.px);
      expect(got.left.px).toBe(got.away.px);
      expect(got.gate.draws).toBe(1);
      expect(got.gate.px).toBe(got.first.px);
    } finally {
      await page?.close();
    }
  }, 120_000);

  /**
   * A CHECKER WITHOUT WEBGL STILL MEASURES A PIECE (the spike's Q4). The browser
   * is the renderer's own shell with `--disable-3d-apis`, reached through
   * `DECKSMITH_CHROME` exactly as the spike reached it. Before the exemption
   * `openDeck` refused this deck, and `fidelity` turned the refusal into a
   * `not_measured` WARNING: the whole gate skipped, PASS printed. The control is
   * the same deck with the mark stripped — still refused, which proves this
   * browser really has no GL and that every other canvas is still guarded.
   */
  it.skipIf(process.platform === "win32")(
    "measures a piece on a checker with no WebGL, and still refuses an unmarked canvas",
    async () => {
      const wrapper = join(dir, "glless-chrome.sh");
      await writeFile(wrapper, `#!/bin/sh\nexec "${chrome}" "$@" --disable-3d-apis\n`, {
        mode: 0o755,
      });
      const saved = {
        hf: process.env.HYPERFRAMES_BROWSER_PATH,
        ds: process.env.DECKSMITH_CHROME,
      };
      delete process.env.HYPERFRAMES_BROWSER_PATH;
      process.env.DECKSMITH_CHROME = wrapper;
      try {
        const page = await openDeck(deck);
        try {
          await page.page.waitForFunction("window.__hfTimelinesBuilding === false");
          await page.seek(6);
          const got = await page.page.evaluate(() => {
            const probe = document.createElement("canvas");
            const cv = document.getElementById("s2-pc") as HTMLCanvasElement;
            const px = cv.getContext("2d")?.getImageData(0, 0, cv.width, cv.height).data ?? [];
            const colours = new Set<string>();
            for (let i = 0; i < px.length; i += 4) {
              colours.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
            }
            return {
              gl: !!(probe.getContext("webgl2") ?? probe.getContext("webgl")),
              colours: colours.size,
            };
          });
          expect(got.gl, "the wrapper did not take GL away; this test measures nothing").toBe(
            false,
          );
          // A blank or background-only canvas is one colour; the piece is many.
          expect(got.colours).toBeGreaterThan(10);
        } finally {
          await page.close();
        }

        const report = await fidelity(deck);
        expect(report.findings.filter((f) => f.rule === "not_measured")).toEqual([]);
        expect(report.stops.length).toBeGreaterThan(0);

        const unmarked = join(dir, "unmarked");
        await cp(deck, unmarked, { recursive: true });
        const html = await readFile(join(unmarked, "index.html"), "utf8");
        expect(html).toContain(` ${PIECE_ATTR} `);
        await writeFile(join(unmarked, "index.html"), html.replace(` ${PIECE_ATTR} `, " "));
        await expect(openDeck(unmarked)).rejects.toThrow(/cannot create a WebGL context/);
      } finally {
        if (saved.hf === undefined) delete process.env.HYPERFRAMES_BROWSER_PATH;
        else process.env.HYPERFRAMES_BROWSER_PATH = saved.hf;
        if (saved.ds === undefined) delete process.env.DECKSMITH_CHROME;
        else process.env.DECKSMITH_CHROME = saved.ds;
      }
    },
    180_000,
  );

  /**
   * A FAILING PIECE FAILS `verify`. Each is the deck above with its piece
   * re-assembled from a broken author file, which is what `copyAssets` writes.
   * Without `reportError` the first passed verify with 0 errors (measured
   * 2026-10-09, the spike's Q2 and again on this runtime); the last is text on
   * morph.js's offscreen layer, which the mounted-canvas trap never saw.
   *
   * The second guards NOTHING the loud-error work added: the author's
   * top-level code runs in the factory, at `mount`, so its throw leaves the
   * scene's timeline unregistered, and that was a page error before
   * `reportError` or the text trap existed. It pins that this stays loud —
   * the spike listed a load-time throw after registering as unmeasured.
   */
  it.each([
    [
      "throws while drawing",
      PIECE.replace(
        "function sceneOnly() {\n",
        "function sceneOnly() {\n  if (TT > 2) STYLE.missingHook(ctx);\n",
      ),
      /page_error\s+STYLE\.missingHook is not a function/,
    ],
    [
      "throws while loading, after it registered",
      `${PIECE}throw new Error("the piece broke while loading");\n`,
      /page_error\s+the piece broke while loading/,
    ],
    [
      "writes text on its offscreen layer",
      PIECE.replace(
        "function sceneOnly() {\n",
        "function sceneOnly() {\n  handText('hi', 300, 300, 60, PAL.ink);\n",
      ),
      /page_error\s+dsAnimate: piece "fig-loop" called fillText — a piece draws no text/,
    ],
  ])(
    "fails verify when the piece %s",
    async (_name, author, said) => {
      const broken = await brokenCopy(_name, author);

      const out = await run(process.execPath, [cli, "verify", broken, "--no-fidelity"]).then(
        (r) => ({ code: 0, stdout: r.stdout }),
        (err: { code?: number; stdout?: string }) => ({ code: err.code, stdout: err.stdout ?? "" }),
      );

      expect(out.code).toBe(1);
      expect(out.stdout).toMatch(said);
      expect(out.stdout).toMatch(/^FAIL — [1-9]\d* error\(s\)/m);
    },
    120_000,
  );

  /**
   * A THROW IN ONE FRAME. `check` samples a long deck coarsely and can step
   * over a short window; `render` would then draw that frame half-painted and
   * exit 0. `fidelity` sweeps every frame of the piece and fails on it, and
   * `frames` — which seeks to it — refuses to write the PNG. The healthy deck
   * is the control for both.
   */
  it("fails fidelity and frames on a piece that throws at one frame only", async () => {
    const broken = await brokenCopy(
      "one frame",
      PIECE.replace(
        "function sceneOnly() {\n",
        "function sceneOnly() {\n  if (F === 77) STYLE.missingHook(ctx);\n",
      ),
    );

    const bad = await fidelity(broken);
    expect(bad.findings.filter((f) => f.rule === "piece_error")).toEqual([
      expect.objectContaining({
        severity: "error",
        message: expect.stringMatching(
          /piece "fig-loop" throws at 1 of its frames \(77–77\): STYLE\.missingHook is not a function/,
        ),
      }),
    ]);
    const good = await fidelity(deck);
    expect(
      good.findings.filter((f) => f.rule === "piece_error" || f.rule === "not_measured"),
    ).toEqual([]);

    // The piece starts at 4.0s in the deck, so its frame 77 is at 4 + 77/30.
    await expect(captureFrames(broken, [4 + 77 / 30], join(dir, "frames-bad"))).rejects.toThrow(
      /frames: the deck raised an error by 6\.567s, so this frame is not what it would draw: .*STYLE\.missingHook is not a function/,
    );
    expect(await captureFrames(deck, [4 + 77 / 30], join(dir, "frames-good"))).toHaveLength(1);
  }, 240_000);
});
