/**
 * The runtime an animate PIECE runs on: a registry the piece's script fills,
 * a `mount` the scene's `measure` calls, and the `dsAnimate` GSAP plugin that
 * draws the piece as part of being seeked.
 *
 * A piece is a figure (`kind: "piece"`, src/types.ts) whose asset is a script:
 * an animate scene file, assembled by src/build/piece.ts with the vendored kit
 * (src/build/animate/) into ONE factory registered here under the figure's id.
 * `claim-figure` draws it on a `<canvas>`. See
 * .planning/2026-10-09-animate-piece-design.md and the spike that measured it.
 *
 * SEEK, NOT PLAY (invariant 1). animate's `renderFrame(t, canvas)` is a pure
 * function of `t` — it repaints from a clean sheet every call — so the plugin's
 * `render` is the only thing that ever draws, and it runs as part of the seek.
 * Nothing here runs on a callback (invariant 11).
 *
 * THE TWEEN VALUE IS THE PIECE'S OWN TIME, IN SECONDS. One convention, chosen
 * because it is the one the spike rendered and watched:
 *
 *   tl.fromTo("#s2-pc", { dsAnimate: 0 }, { dsAnimate: S, duration: S, ease: "none" }, at)
 *
 * where `S` is the figure's `seconds`. The tween's value at ratio `r` is
 * `r * S`, a piece-local second, and the tween runs at 1:1 with the deck's
 * clock. A 0-to-1 value would work too (design A wrote it), but two conventions
 * in one codebase is how one of them gets the other's arithmetic.
 *
 * THE LAST-FRAME CLAMP. morph.js picks its frame as
 * `round(t * FPS) % NFRAMES`, so the tween's end, `t = S`, is frame NFRAMES —
 * which wraps to frame 0. The piece would snap back to its first pose for the
 * whole hold after it. `pieceTime` stops at `(n - 1) / fps`, the last frame
 * that exists.
 *
 * A DRAWING ERROR IS A PAGE ERROR. The hyperframes runtime runs every seek
 * inside a `catch` that reports only to a hook the page must install, so an
 * error thrown from `render` vanished: lint, check, verify and render all
 * exited 0 over a canvas frozen on its last good pose (the spike's Q2). So
 * `render` hands the error to `reportError` — the browser's own "uncaught
 * exception" path, synchronous, which `hyperframes check` records as a
 * `page_error` and so fails `decksmith verify` — and then rethrows it for any
 * caller that does not swallow. `render` still exits 0; verify is the gate.
 *
 * ONE DRAW PER FRAME. hyperframes' transport seek moves the timeline three
 * times per captured frame (`N`, `N + .001`, `N`), and each one used to repaint
 * the whole piece. morph.js draws a pure function of `round(t * FPS)` (with
 * `sub` unset), so a second draw of the same frame on the same canvas paints
 * the same pixels: `render` skips it. The memo is per canvas, cleared before a
 * draw and set only after it returns: a draw that throws leaves the canvas
 * half-painted, so it must not be remembered as holding any frame.
 *
 * Bundled to an IIFE by `scripts/build.mjs` as `dist/ds-animate.js` and loaded
 * by a deck only when some scene names `dsAnimate` (PLUGINS in
 * composition.ts). The pure halves are exported for the tests, which is why the
 * window registration at the bottom is guarded.
 */

/** What the scene's `measure` passes `mount`: the numbers the factory's head needs. */
export interface PieceConfig {
  /** The piece's length — the figure's `seconds`. */
  seconds: number;
  /** Frames per second the piece is baked at. */
  fps: number;
  /** The deck's font stack, for the kit's `HAND`. No text is drawn; see `mount`. */
  hand: string;
}

/** What a piece's factory hands back: animate's seekable draw, and its frame count. */
export interface Piece {
  rf: (t: number, canvas: HTMLCanvasElement) => unknown;
  n: number;
  fps: number;
}

/** A piece's script registers one of these under its figure id. */
export type PieceFactory = (cfg: PieceConfig & { width: number; height: number }) => Piece;

/**
 * The attribute `claim-figure` writes on a piece's `<canvas>`. It says the
 * canvas is 2D by construction: `mount` takes its 2D context before anything
 * draws, and a canvas holding a 2D context can never hold a WebGL one. The
 * capture path (`openDeck`, src/render/capture.ts) reads it to exempt the
 * canvas from its no-WebGL refusal, which otherwise refused every piece on a
 * checker without GL and so skipped the whole fidelity gate (the spike's Q4).
 */
export const PIECE_ATTR = "data-ds-piece";

/** Filled by each piece's script as the document parses. */
export const pieces: Record<string, PieceFactory> = {};

/** A mounted piece: what draws it, and the frame its canvas last finished drawing. */
interface Host {
  id: string;
  piece: Piece;
  drawn: number;
}

const HOSTS = new WeakMap<object, Host>();

/**
 * The piece-local second to draw at tween value `t`: `t`, but never past the
 * last frame — see THE LAST-FRAME CLAMP above.
 */
export function pieceTime(t: number, piece: { n: number; fps: number }): number {
  return Math.min(t, (piece.n - 1) / piece.fps);
}

/**
 * NO TEXT FROM A PIECE (invariant 5). Canvas text cannot be seen by the type
 * floor, so while piece `id` runs — its factory, and every draw — `fillText`
 * and `strokeText` throw on EVERY 2D context, not only the mounted canvas's:
 * morph.js draws each era on an offscreen layer it creates itself
 * (`layer(0)`), and an author's file can create more. Swapped on the
 * prototypes for exactly the length of the call and restored in `finally`, so
 * no other canvas on the page is ever affected. A throw from the trap is a
 * drawing error like any other: see A DRAWING ERROR IS A PAGE ERROR above.
 *
 * In node there are no canvas prototypes and so nothing to swap; the browser
 * test in test/animate-piece.test.ts is what measures this.
 */
function withoutText<T>(id: string, run: () => T): T {
  const g = globalThis as {
    CanvasRenderingContext2D?: { prototype: CanvasText };
    OffscreenCanvasRenderingContext2D?: { prototype: CanvasText };
  };
  const protos = [g.CanvasRenderingContext2D, g.OffscreenCanvasRenderingContext2D].flatMap((c) =>
    c ? [c.prototype] : [],
  );
  const saved = protos.map((p) => [p.fillText, p.strokeText] as const);
  const refuse = (name: string) => () => {
    throw new Error(
      `dsAnimate: piece "${id}" called ${name} — a piece draws no text (invariant 5)`,
    );
  };
  for (const p of protos) {
    p.fillText = refuse("fillText");
    p.strokeText = refuse("strokeText");
  }
  try {
    return run();
  } finally {
    protos.forEach((p, i) => {
      [p.fillText, p.strokeText] = saved[i] as (typeof saved)[number];
    });
  }
}

/**
 * Build piece `id` against `canvas`. Called from the scene's `measure`, inside
 * the ready gate, so it runs once, before the timeline that tweens it exists.
 * A throw from the factory — the author's file runs here, not at script load —
 * leaves the scene's timeline unregistered, which `check` already reports.
 *
 * THE CONTEXT IS TAKEN HERE, FIRST, with `willReadFrequently`, so the raster
 * mode is fixed from frame 0 rather than flipped by whatever reads it back
 * later (.planning/2026-09-06-canvas-seek-purity.md).
 */
export function mount(canvas: HTMLCanvasElement | null, id: string, cfg: PieceConfig): void {
  if (!canvas) throw new Error(`DSAnimate.mount: no canvas for piece "${id}"`);
  const factory = Object.hasOwn(pieces, id) ? pieces[id] : undefined;
  if (!factory) {
    throw new Error(
      `DSAnimate.mount: no piece registered as "${id}" — its <script src> did not run`,
    );
  }
  if (!canvas.getContext("2d", { willReadFrequently: true })) {
    throw new Error(`DSAnimate.mount: piece "${id}" got no 2D context`);
  }
  const piece = withoutText(id, () =>
    factory({ ...cfg, width: canvas.width, height: canvas.height }),
  );
  HOSTS.set(canvas, { id, piece, drawn: Number.NaN });
}

interface PluginState {
  host: Host;
  canvas: HTMLCanvasElement;
  end: number;
}

/**
 * `dsAnimate` as a GSAP property. The tween's ease must be "none": the value is
 * a clock, and an ease would play the piece at a varying speed.
 */
export const DSAnimatePlugin = {
  name: "dsAnimate",
  init(this: PluginState, target: HTMLCanvasElement, value: unknown): void {
    const host = HOSTS.get(target);
    // Loud, not silent: a tween on a canvas nothing mounted would otherwise
    // draw nothing with every gate green.
    if (!host) {
      throw new Error(
        `dsAnimate: nothing mounted on #${target.id}; DSAnimate.mount must run in measure`,
      );
    }
    this.host = host;
    this.canvas = target;
    this.end = Number(value);
  },
  render(ratio: number, d: PluginState): void {
    const { host } = d;
    const t = pieceTime(ratio * d.end, host.piece);
    // The frame morph.js will draw for `t` — see ONE DRAW PER FRAME above.
    const frame = Math.round(t * host.piece.fps);
    if (frame === host.drawn) return;
    host.drawn = Number.NaN;
    try {
      withoutText(host.id, () => host.piece.rf(t, d.canvas));
    } catch (err) {
      reportError(err);
      throw err;
    }
    host.drawn = frame;
  },
};

if (typeof window !== "undefined") {
  const w = window as unknown as { DSAnimate: unknown; DSAnimatePlugin: unknown };
  w.DSAnimate = { pieces, mount };
  w.DSAnimatePlugin = DSAnimatePlugin;
}
