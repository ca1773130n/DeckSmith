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
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { copyAssets } from "../src/build/files.js";
import { assemblePiece } from "../src/build/piece.js";
import { DSAnimatePlugin, mount, pieces, pieceTime } from "../src/emit/animate-runtime.js";
import { scanDeterminism } from "../src/verify/index.js";

/** Accepts any property read, call or arithmetic, and is always itself. */
const ANY: unknown = new Proxy(() => {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : ANY),
  apply: () => ANY,
  set: () => true,
});

/** A canvas whose 2D context records what is assigned to it and no-ops the rest. */
function fakeCanvas(id = "s2-pc", width = 1920, height = 1080) {
  const own: Record<PropertyKey, unknown> = {};
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
  cut(rect(LX(0.2), LY(0.2), 200 * UNIT, 200 * UNIT, 8), PAL.orange, { key: 'box' });
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
});

describe("the dsAnimate plugin", () => {
  /** Mount a fresh copy of the fixture piece and return what a tween needs. */
  async function mounted(id: string, seconds: number) {
    const frames = load(await assemblePiece(id, `${id}.js`, AUTHOR));
    const canvas = fakeCanvas(`${id}-pc`);
    mount(canvas, id, { seconds, fps: 30, hand: '"Inter", sans-serif' });
    const state = {} as Parameters<typeof DSAnimatePlugin.render>[1];
    DSAnimatePlugin.init.call(state, canvas, seconds);
    return { frames, canvas, state };
  }

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

  it("refuses text on the mounted canvas, so no glyph escapes the type floor", async () => {
    const { canvas } = await mounted("text", 2);
    const ctx = canvas.getContext("2d") as unknown as {
      fillText: () => void;
      strokeText: () => void;
    };

    expect(() => ctx.fillText()).toThrow(
      /piece "text" called fillText — no text on a piece canvas/,
    );
    expect(() => ctx.strokeText()).toThrow(/called strokeText/);
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
});
