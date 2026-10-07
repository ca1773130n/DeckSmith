/**
 * Give an already-built deck page the current player, without rebuilding it.
 *
 * A deck page is the HyperFrames player tag, three JSON islands (slides,
 * narration, and — on a deck with a player-page clip — video) and the runtime
 * inlined as the LAST bare `<script>` before `</body>` (`emitDeckPage` in
 * src/emit/composition.ts). Everything about the deck is in the islands and
 * the files beside the page; everything about the PLAYER is in that one script.
 * So swapping the script, and adding the v2 marker, is the whole migration: no
 * Chrome, no TTS, no planner, and nothing about the slides can move.
 *
 * TEXT SURGERY, NOT A RE-EMIT, on purpose. Re-emitting from the islands would
 * mean a second copy of the page template that drifts from `emitDeckPage`, and
 * would rewrite bytes this does not need to touch — the head's own style, the
 * player tag, any island this reader has never heard of. Here, everything but
 * the runtime is kept byte for byte, which is what `repackDeckPage` checks
 * before it returns.
 */
import { closeSafe } from "../emit/composition.js";
import { markV2 } from "./playback.js";

const OPEN = "<script>";
const CLOSE = "</script>";
/** Every JSON island, whatever its type — the video island included, which most decks lack. */
const ISLAND = /<script type="application\/[a-z0-9.+-]*json">[\s\S]*?<\/script>/g;

/** The islands of a deck page, in order, exactly as written. */
export function islandsOf(page: string): string[] {
  return page.match(ISLAND) ?? [];
}

/**
 * `page` with `runtimeJs` as its player and the v2 marker in its head.
 * Idempotent: repacking a repacked page with the same runtime returns it unchanged.
 *
 * Throws, rather than writing something half-right, on a page that is not a
 * deck page or whose runtime script cannot be found where the emitter puts it.
 */
export function repackDeckPage(page: string, runtimeJs: string): string {
  if (!page.includes('type="application/hyperframes-slideshow+json"')) {
    throw new Error("not a deck page: it has no slideshow island");
  }
  const body = page.lastIndexOf("</body>");
  const close = page.lastIndexOf(CLOSE, body);
  const open = page.lastIndexOf(OPEN, close);
  // The runtime is the last script in the body and the only bare one. A typed
  // island between `open` and `close` would mean we found an island's closing
  // tag instead, i.e. the page has no inline runtime where we expect one.
  if (body < 0 || close < 0 || open < 0 || page.slice(open, close).includes("<script ")) {
    throw new Error("not a deck page this can repack: no inline runtime before </body>");
  }
  if (closeSafe(runtimeJs).includes(OPEN)) {
    // Would make the NEXT repack find the wrong opening tag.
    throw new Error("the runtime bundle contains a literal <script>; refusing to inline it");
  }

  const out = markV2(
    `${page.slice(0, open + OPEN.length)}\n${closeSafe(runtimeJs)}\n    ${page.slice(close)}`,
  );

  const before = islandsOf(page);
  const after = islandsOf(out);
  if (before.length !== after.length || before.some((island, i) => island !== after[i])) {
    throw new Error("repack would have changed a JSON island; nothing written");
  }
  return out;
}
