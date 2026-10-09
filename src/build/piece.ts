/**
 * An animate PIECE, assembled: the author's scene file wrapped with the
 * vendored kit into the one script a deck loads for it.
 *
 * animate builds a piece by concatenating parts into one `<script>` (its
 * tools/build.mjs: head, kit/core, style, scenes, bridges, kit/morph, board,
 * score). This is that order with the parts DeckSmith does not run left out —
 * no head.html (it reads `location.search`), no board, no score (rAF and
 * `performance.now`) — and with the head's constants coming from the deck
 * rather than from the URL.
 *
 * ONE FACTORY, NOT ONE GLOBAL SCOPE. The whole assembly is the body of a
 * function registered as `DSAnimate.pieces[id]` (src/emit/animate-runtime.ts),
 * so the kit's hundreds of top-level names live in that function and nowhere
 * else (invariant 3). `mount` calls it with the canvas's size, the piece's
 * seconds, its fps and the deck's font stack.
 *
 * WHAT THE AUTHOR'S FILE DEFINES, as an animate `scenes.js` plus `bridges.js`:
 * `ERA_LIST`, `SHOTS`, `ERA_BG`, `BRIDGES`, `pieceCam` and its scene functions.
 * It must NOT define what the head below does — `W`, `H`, `FPS`, `DURATION`,
 * `NFRAMES`, `LOOP_T`, `SAFE`, `HAND`, `CX` — nor `TIMELINE`, which is built
 * here from its `SHOTS`. A redeclaration is a SyntaxError when the deck loads,
 * which `check` and `verify` report as a page error. It must draw no text: see
 * `mount`.
 *
 * Deterministic by construction: the same author file and id assemble to the
 * same bytes, which is what keeps two builds of one deck identical.
 */
import { readFile } from "node:fs/promises";

/** The kit, in animate's build order around the author's file. Read from beside the bundle. */
const KIT_BEFORE = ["core.js", "cut-paper.js"] as const;
const KIT_AFTER = ["morph.js"] as const;

/**
 * `src/build/animate/` under test, `dist/animate/` when bundled into
 * `dist/cli.js` and `dist/index.js` — `scripts/build.mjs` copies the one to the
 * other, as it builds `ds-morph.js` beside the same bundles.
 */
const kit = (name: string) => readFile(new URL(`./animate/${name}`, import.meta.url), "utf8");

/**
 * The head animate's `head.html` would define, from the factory's argument.
 * `SAFE` is animate's 16:9 entry; it places only captions and tags, which a
 * piece may not draw.
 */
const HEAD = [
  "const W = cfg.width, H = cfg.height, FPS = cfg.fps, DURATION = cfg.seconds, HAND = cfg.hand;",
  "const NFRAMES = Math.round(DURATION * FPS), LOOP_T = NFRAMES / FPS;",
  "const SAFE = { top: 60, bottom: 110, right: 60 };",
  "const CX = (W - SAFE.right) / 2;",
].join("\n");

/** morph.js reads `TIMELINE.shots` and nothing else of it. */
const TIMELINE =
  "const TIMELINE = { shots: SHOTS.map(([key, era, t0, t1, title], i) => ({ id: i + 1, key, era, t0, t1, title })) };";

/**
 * The script for piece `id`, whose author file `name` (the figure's `src`)
 * holds `author`.
 *
 * The MIT notice rides at the top of every assembled file because the file IS a
 * copy of the kit, shipped inside someone else's deck.
 */
export async function assemblePiece(id: string, name: string, author: string): Promise<string> {
  const license = await kit("LICENSE");
  const part = async (file: string) => `// ==== animate kit/${file}\n${await kit(file)}`;
  return [
    `// ${name} — an animate piece, assembled by DeckSmith (src/build/piece.ts) for figure ${JSON.stringify(id)}.`,
    "// The kit inside is animate @7e5eb56 (https://github.com/cth9191/animate), vendored unmodified:",
    ...license
      .trimEnd()
      .split("\n")
      .map((l) => `//   ${l}`.trimEnd()),
    `window.DSAnimate.pieces[${JSON.stringify(id)}] = function (cfg) {`,
    '"use strict";',
    HEAD,
    ...(await Promise.all(KIT_BEFORE.map(part))),
    `// ==== ${name}\n${author}`,
    TIMELINE,
    ...(await Promise.all(KIT_AFTER.map(part))),
    "return { rf: renderFrame, n: NFRAMES, fps: FPS };",
    "};",
    "",
  ].join("\n");
}
