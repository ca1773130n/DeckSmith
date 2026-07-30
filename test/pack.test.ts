import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type Fetcher, isEmbed, mediaSummary, planMedia, policyFor } from "../src/pack/media.js";
import { type Pack, readPack, writePack } from "../src/pack/pack.js";
import { PACK_VERSION, prefsSchema, sourceSchema, storyboardSchema } from "../src/types.js";

const dir = async () => mkdtemp(join(tmpdir(), "decksmith-pack-"));

/** The smallest thing the schema will accept: one source, one beat. */
function fixture(over: Partial<Pack> = {}): Pack {
  return {
    version: PACK_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "A Pack",
    prefs: prefsSchema.parse({}),
    source: sourceSchema.parse({
      id: "src",
      title: "A Pack",
      sections: [{ id: "s1", depth: 1, heading: "Intro", text: "Prose." }],
      figures: [],
      equations: [],
      tables: [],
    }),
    storyboard: storyboardSchema.parse({
      sourceId: "src",
      title: "A Pack",
      beats: [
        {
          id: "b1",
          intent: "Open",
          archetype: "title",
          params: { headline: "A Pack" },
        },
      ],
    }),
    media: [],
    ...over,
  };
}

/** Bytes that are not an image, so nothing here can be mistaken for one. */
const BAKED = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe("policyFor", () => {
  it("embeds player URLs whatever the caller asked for", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/76979871",
      "https://player.vimeo.com/video/76979871",
    ]) {
      expect(isEmbed(url)).toBe(true);
      expect(policyFor(url, "bake")).toBe("embed");
      expect(policyFor(url, "link")).toBe("embed");
    }
  });

  it("bakes a file-shaped URL and a local path", () => {
    expect(policyFor("https://cdn.example.com/fig/1.png", "bake")).toBe("bake");
    expect(policyFor("assets/fig.jpg", "bake")).toBe("bake");
  });

  it("prefers link over bake when the URL is not obviously a file", () => {
    // Baking this would store whatever HTML the host felt like returning.
    expect(policyFor("https://example.com/gallery?id=3", "bake")).toBe("link");
    expect(policyFor("https://example.com/fig/1.png", "link")).toBe("link");
  });

  it("bakes a local path even under --link, because there is no link to keep", () => {
    // `ingest` rewrites every figure's src to its local copy, so by pack time a
    // "link" could only record this machine's filesystem. A pack that stores
    // /Users/someone/deck/assets/fig.jpg unpacks on another machine into a deck
    // whose <img> resolves to nothing, and only the lint gate over there notices.
    expect(policyFor("/Users/someone/deck/assets/fig.jpg", "link")).toBe("bake");
    expect(policyFor("assets/fig.jpg", "link")).toBe("bake");
    expect(policyFor("data:image/png;base64,AAAA", "link")).toBe("bake");
  });
});

describe("planMedia", () => {
  const fetcher = (calls: string[]): Fetcher => {
    return async (url) => {
      calls.push(url);
      return { bytes: BAKED, mime: "image/png" };
    };
  };

  it("never fetches a player URL", async () => {
    const calls: string[] = [];
    const plan = await planMedia(
      [{ id: "clip", url: "https://www.youtube.com/watch?v=abc", prefer: "bake" }],
      fetcher(calls),
    );
    expect(calls).toEqual([]);
    expect(plan.media[0]).toMatchObject({
      id: "clip",
      policy: "embed",
      url: "https://www.youtube.com/watch?v=abc",
    });
    expect(plan.bakedBytes).toBe(0);
    // The caller asked to bake it; it should be told that it did not get that.
    expect(plan.demoted).toEqual(["clip"]);
    expect(plan.promoted).toEqual([]);
  });

  it("reports a local asset that --link could not honour", async () => {
    const calls: string[] = [];
    const plan = await planMedia(
      [
        { id: "local", url: "assets/fig.jpg", prefer: "link" },
        { id: "remote", url: "https://cdn.example.com/b.png", prefer: "link" },
      ],
      fetcher(calls),
    );
    expect(calls).toEqual(["assets/fig.jpg"]);
    expect(plan.media[0]).toMatchObject({ id: "local", policy: "bake" });
    expect(plan.media[1]).toMatchObject({ id: "remote", policy: "link" });
    // Silently baking under --link would make the pack's size inexplicable.
    expect(plan.promoted).toEqual(["local"]);
    expect(plan.demoted).toEqual([]);
  });

  it("reports what was baked, so the size of the pack is never a surprise", async () => {
    const calls: string[] = [];
    const plan = await planMedia(
      [
        { id: "fig1", url: "https://cdn.example.com/a.png", prefer: "bake" },
        { id: "fig2", url: "https://cdn.example.com/b.png", prefer: "link" },
        { id: "clip", url: "https://vimeo.com/1", prefer: "link" },
      ],
      fetcher(calls),
    );
    expect(calls).toEqual(["https://cdn.example.com/a.png"]);
    expect(plan.bakedCount).toBe(1);
    expect(plan.bakedBytes).toBe(BAKED.length);
    expect(mediaSummary(plan)).toBe("1 baked (8 B), 1 linked, 1 embedded");
  });

  it("keeps the URL when the fetch turns out to be a page", async () => {
    const plan = await planMedia(
      [{ id: "fig", url: "https://x.test/a.png", prefer: "bake" }],
      async () => ({
        bytes: new TextEncoder().encode("<html>login</html>"),
        mime: "text/html; charset=utf-8",
      }),
    );
    expect(plan.media[0]?.policy).toBe("link");
    expect(plan.files).toEqual({});
  });

  it("names baked files by id and URL hash, so a rewritten asset cannot collide", async () => {
    const calls: string[] = [];
    const plan = await planMedia(
      [{ id: "Fig One", url: "https://cdn.example.com/a.png", prefer: "bake" }],
      fetcher(calls),
    );
    const path = plan.media[0]?.path ?? "";
    expect(path).toMatch(/^media\/fig-one-[0-9a-f]{8}\.png$/);
    expect(plan.files[path]).toEqual(BAKED);
  });
});

describe("writePack / readPack", () => {
  it("round-trips the manifest and the baked bytes", async () => {
    const out = join(await dir(), "a.deck");
    const plan = await planMedia(
      [
        { id: "fig1", url: "https://cdn.example.com/a.png", prefer: "bake" },
        { id: "fig2", url: "https://cdn.example.com/b.png", prefer: "link" },
        { id: "clip", url: "https://www.youtube.com/watch?v=abc", prefer: "link" },
      ],
      async () => ({ bytes: BAKED, mime: "image/png" }),
    );
    const audio = { "audio/b1-0.mp3": new Uint8Array([9, 9, 9]) };
    const pack = fixture({ media: plan.media });

    const size = await writePack(pack, { ...plan.files, ...audio }, out);
    expect(size).toBeGreaterThan(0);

    const back = await readPack(out);
    expect(back.pack).toEqual(pack);
    expect(back.files).toEqual({ ...plan.files, ...audio });
    // Nothing derived travels in a pack.
    expect(Object.keys(back.files).some((k) => k.endsWith(".html"))).toBe(false);
  });

  it("writes the same bytes twice for the same pack", async () => {
    const d = await dir();
    const pack = fixture();
    await writePack(pack, { "audio/b1-0.mp3": BAKED }, join(d, "a.deck"));
    await writePack(pack, { "audio/b1-0.mp3": BAKED }, join(d, "b.deck"));
    expect(await readFile(join(d, "a.deck"))).toEqual(await readFile(join(d, "b.deck")));
  });

  it("refuses to write a baked asset whose bytes are missing", async () => {
    const out = join(await dir(), "a.deck");
    const pack = fixture({
      media: [{ id: "fig1", policy: "bake", path: "media/fig1.png", bytes: 8 }],
    });
    await expect(writePack(pack, {}, out)).rejects.toThrow(/media\/fig1\.png was not given/);
  });

  it("says what wrote a pack it cannot read", async () => {
    const out = join(await dir(), "future.deck");
    const zip = zipSync({
      "deck.json": new TextEncoder().encode(JSON.stringify({ ...fixture(), version: 99 })),
    });
    await writeFile(out, zip);
    await expect(readPack(out)).rejects.toThrow(
      new RegExp(`written by pack format v99.*understands v${PACK_VERSION}`),
    );
  });

  it("rejects a manifest that is not a pack", async () => {
    const out = join(await dir(), "bad.deck");
    const bad = { ...fixture(), title: 42 };
    await writeFile(out, zipSync({ "deck.json": new TextEncoder().encode(JSON.stringify(bad)) }));
    await expect(readPack(out)).rejects.toThrow(/not a valid pack — title:/);
  });

  it("fails clearly on a truncated pack rather than throwing a decompressor internal", async () => {
    const out = join(await dir(), "cut.deck");
    const full = join(await dir(), "full.deck");
    await writePack(fixture(), { "audio/b1-0.mp3": BAKED }, full);
    const bytes = await readFile(full);
    await writeFile(out, bytes.subarray(0, 40));
    await expect(readPack(out)).rejects.toThrow(/corrupt \.deck archive/);
  });

  it("fails clearly on a file that is not a zip at all", async () => {
    const out = join(await dir(), "notes.deck");
    await writeFile(out, "just some text\n");
    await expect(readPack(out)).rejects.toThrow(/no zip header/);
  });

  it("rejects an entry whose path escapes the pack", async () => {
    const out = join(await dir(), "evil.deck");
    await writeFile(
      out,
      zipSync({
        "deck.json": new TextEncoder().encode(JSON.stringify(fixture())),
        "../../etc/passwd": BAKED,
      }),
    );
    await expect(readPack(out)).rejects.toThrow(/unsafe path/);
  });
});
