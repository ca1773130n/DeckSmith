/**
 * `decksmith repack`: a built deck page gets the current runtime and the v2
 * marker, and NOTHING else about it changes. The browser half — that the
 * repacked page still drives the deck's own vendored player — is in
 * test/deck-page.test.ts.
 *
 * Real decks: set DECKSMITH_REPACK_CORPUS to a directory, and every deck.html
 * under it (any depth) is round-tripped too. CI has none, so it is skipped
 * there; on a machine with HypePaper's run directories it is the test that
 * matters, because those pages were written by releases this one never saw.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAYER_MARKER } from "../src/deck/playback.js";
import { islandsOf, repackDeckPage } from "../src/deck/repack.js";
import { emitDeck } from "../src/emit/composition.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";

const OLD = "/* the v0.8.0 runtime */";
const NEW = "/* the v2 runtime */";

async function fixturePage(): Promise<string> {
  const read = async (rel: string) =>
    JSON.parse(await readFile(new URL(`../demo/fixtures/${rel}`, import.meta.url), "utf8"));
  const storyboard = storyboardSchema.parse(await read("plain.storyboard.json"));
  const source = sourceSchema.parse(await read("plain.source.json"));
  const page = emitDeck(storyboard, source, FORMATS["deck-16x9"] as Format, OLD).page;
  if (!page) throw new Error("the fixture format is not navigable");
  return page;
}

describe("repackDeckPage", () => {
  it("swaps the runtime and marks the page, keeping every island byte for byte", async () => {
    const page = await fixturePage();
    const out = repackDeckPage(page, NEW);
    expect(out).toContain(PLAYER_MARKER);
    expect(out).toContain(NEW);
    expect(out).not.toContain(OLD);
    expect(islandsOf(out)).toEqual(islandsOf(page));
    expect(islandsOf(page).length).toBeGreaterThan(0);
  });

  it("changes nothing but the runtime and the marker", async () => {
    const page = await fixturePage();
    const out = repackDeckPage(page, NEW);
    expect(out.replace(`\n    ${PLAYER_MARKER}`, "").replace(NEW, OLD)).toBe(page);
  });

  it("is idempotent", async () => {
    const once = repackDeckPage(await fixturePage(), NEW);
    expect(repackDeckPage(once, NEW)).toBe(once);
  });

  it("refuses what is not a deck page", () => {
    expect(() => repackDeckPage("<html><head></head><body></body></html>", NEW)).toThrow(
      /no slideshow island/,
    );
  });

  it("refuses a deck page with no inline runtime where the emitter puts it", async () => {
    const page = (await fixturePage()).replace(/<script>[\s\S]*?<\/script>\s*<\/body>/, "</body>");
    expect(() => repackDeckPage(page, NEW)).toThrow(/no inline runtime/);
  });

  it("refuses a runtime that would hide the next repack's anchor", async () => {
    const page = await fixturePage();
    expect(() => repackDeckPage(page, 'x="<script>"')).toThrow(/literal <script>/);
  });

  it("escapes a closing tag inside the runtime, as the emitter does", async () => {
    const out = repackDeckPage(await fixturePage(), 's="</script>"');
    expect(out).toContain('s="<\\/script>"');
  });
});

const corpus = process.env.DECKSMITH_REPACK_CORPUS;

async function* deckPages(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* deckPages(path);
    else if (entry.name === "deck.html") yield path;
  }
}

describe.skipIf(!corpus)("repack over real decks ($DECKSMITH_REPACK_CORPUS)", () => {
  it("round-trips every deck: islands kept, marker added, idempotent", async () => {
    const runtime = await readFile(new URL("../dist/deck-runtime.js", import.meta.url), "utf8");
    let n = 0;
    for await (const path of deckPages(corpus as string)) {
      const page = await readFile(path, "utf8");
      const out = repackDeckPage(page, runtime);
      expect(islandsOf(out), path).toEqual(islandsOf(page));
      expect(out, path).toContain(PLAYER_MARKER);
      expect(repackDeckPage(out, runtime), path).toBe(out);
      n++;
    }
    expect(n).toBeGreaterThan(0);
    console.log(`repack: ${n} real deck pages round-tripped`);
  }, 120_000);
});
