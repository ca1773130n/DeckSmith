/**
 * The harvest stage: a URL in, a markdown document and a directory of files out.
 *
 * Two halves, and they are split by what they need rather than by what they
 * cover. The second half drives a real Chrome against real `node:http` servers
 * on loopback and is the only place the interception rule can be proved — a
 * browser that "makes no requests" is a claim about a process, and the only
 * evidence is a server that was never hit. The first half runs `toMarkdown` on
 * its own, with no browser at all, because THE DIALECT RULES ARE THE DANGEROUS
 * PART: break one and no gate fires, no error is thrown, and the deck simply
 * comes out without its figures. CI has no Chrome — the workflow says so in as
 * many words — so that half has to run without one, and it does.
 *
 * Reaching loopback at all needs `allowLoopback`, which is `fetchGuarded`'s
 * declared test seam, passed through by `HarvestOptions`. It exempts 127.0.0.0/8
 * and lifts the 80/443 rule and does nothing else, so the refusal asserted below
 * against 169.254.169.254 is the production guard firing. NOTHING HERE REACHES
 * THE NETWORK: every address is loopback or a literal `dns.lookup` short-circuits.
 */
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromePath } from "../src/render/capture.js";
import { fetchFigures } from "../src/source/assets.js";
import { attachClips, harvest, toMarkdown, videoSize } from "../src/source/harvest.js";
import { parseMarkdown } from "../src/source/markdown.js";

/* ---------------------------------------------------------------- Fixtures */

/** Signature, IHDR type and the two extents — everything `imageSize` reads. */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b.write("\x89PNG\r\n\x1a\n", 0, "latin1");
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** One ISO base media box, which is a big-endian size, a four-character type and a body. */
function box(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

/**
 * `ftyp` then `moov{mvhd, trak{tkhd}}` — everything `videoSize` reads and not one
 * byte of picture, exactly as `png` above carries no pixels.
 *
 * `turned` writes the 90° display matrix a phone puts on portrait video, which
 * is the case where the header's own width and height are the wrong way round.
 */
function mp4(width: number, height: number, seconds: number, turned = false): Buffer {
  const timescale = 600;
  const mvhd = Buffer.alloc(24); // version 0: timescale at 12, duration at 16
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(seconds * timescale), 16);
  const tkhd = Buffer.alloc(84); // version 0: matrix at 40, width at 76, height at 80
  const one = 0x00010000;
  tkhd.writeInt32BE(turned ? 0 : one, 40); // a
  tkhd.writeInt32BE(turned ? one : 0, 44); // b
  tkhd.writeInt32BE(turned ? -one : 0, 52); // c
  tkhd.writeInt32BE(turned ? 0 : one, 56); // d
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([
    box("ftyp", Buffer.from("isomisomiso2mp41", "latin1")),
    box("moov", Buffer.concat([box("mvhd", mvhd), box("trak", box("tkhd", tkhd))])),
  ]);
}

/** An EBML element: id bytes as they are written, a four-byte size vint, a body. */
function el(id: number[], body: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  size[0] = (size[0] ?? 0) | 0x10; // the four-byte length marker
  return Buffer.concat([Buffer.from(id), size, body]);
}

/** The EBML header, then `Segment{Info{TimecodeScale,Duration}, Tracks{...Video{...}}}`. */
function webm(width: number, height: number, seconds: number): Buffer {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const scale = 1_000_000; // nanoseconds a tick, which is also webm's default
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE((seconds * 1e9) / scale);
  const info = el(
    [0x15, 0x49, 0xa9, 0x66],
    Buffer.concat([el([0x2a, 0xd7, 0xb1], u32(scale)), el([0x44, 0x89], duration)]),
  );
  const video = el([0xe0], Buffer.concat([el([0xb0], u32(width)), el([0xba], u32(height))]));
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], video));
  return Buffer.concat([
    el([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0)),
    el([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks])),
  ]);
}

const work = () => mkdtemp(join(tmpdir(), "ds-harvest-"));

/* ------------------------------------------------ The dialect, without Chrome */

describe("toMarkdown, read back by parseMarkdown", () => {
  it("gives every figure back, with the caption the page stated", () => {
    const md = toMarkdown([
      { kind: "heading", depth: 1, text: "Sparse attention" },
      { kind: "paragraph", text: "The pipeline is drawn in Figure 1." },
      {
        kind: "image",
        src: "/assets/diagram.png",
        alt: "the pipeline",
        caption: "Figure 1 — end to end",
      },
      { kind: "image", src: "/assets/plot.png", alt: "the loss curve", caption: "" },
    ]);
    const source = parseMarkdown(md);

    expect(source.title).toBe("Sparse attention");
    expect(source.figures.map((f) => [f.src, f.caption])).toEqual([
      ["/assets/diagram.png", "Figure 1 — end to end"],
      // No figcaption on the page, so the alt text is the caption. It is emitted
      // as the emphasis paragraph rather than left to `img.alt`, because a
      // figure with an empty caption is one the planner cannot place.
      ["/assets/plot.png", "the loss curve"],
    ]);
    // The prose that names the figure, which is half of what the planner has to
    // decide where a figure belongs.
    expect(source.figures[0]?.mention).toBe("The pipeline is drawn in Figure 1.");
  });

  it("does not let an italic paragraph steal the caption of the image above it", () => {
    // The failure this escaping exists for: `captionOf` reads ANY following
    // single-emphasis paragraph as the caption, so an unescaped pull quote
    // would replace the real one and nothing would say so.
    const md = toMarkdown([
      { kind: "image", src: "/a.png", alt: "", caption: "Figure 2 — the real caption" },
      { kind: "paragraph", text: "*a pull quote in the page's own asterisks*" },
    ]);
    const source = parseMarkdown(md);

    expect(source.figures).toHaveLength(1);
    expect(source.figures[0]?.caption).toBe("Figure 2 — the real caption");
    expect(source.sections[0]?.text).toContain("*a pull quote in the page's own asterisks*");
  });

  it("keeps text that looks like html, which both walkers would otherwise drop", () => {
    // `blockText` and `textOf` in markdown.ts both return "" for a raw html
    // node, so an unescaped `<script>` in prose does not become dangerous — it
    // becomes INVISIBLE, taking the sentence around it with it.
    const md = toMarkdown([
      { kind: "paragraph", text: "Write <script> to embed one, and <div> for a block." },
    ]);
    expect(parseMarkdown(md).sections[0]?.text).toBe(
      "Write <script> to embed one, and <div> for a block.",
    );
  });

  it("keeps a sentence that opens like a heading or a list item as prose", () => {
    const md = toMarkdown([
      { kind: "heading", depth: 2, text: "Notation" },
      { kind: "paragraph", text: "# is the count operator." },
      { kind: "paragraph", text: "1. Ordered lists are written like this." },
      { kind: "paragraph", text: "- and unordered ones like this." },
    ]);
    const source = parseMarkdown(md);

    expect(source.sections).toHaveLength(1);
    expect(source.sections[0]?.heading).toBe("Notation");
    expect(source.sections[0]?.text.split("\n\n")).toEqual([
      "# is the count operator.",
      "1. Ordered lists are written like this.",
      "- and unordered ones like this.",
    ]);
  });

  it("writes a table wide enough for its raggedest row", () => {
    const md = toMarkdown([
      { kind: "table", columns: ["Model", "Score"], rows: [["ours", "91.2", "±0.3"], ["theirs"]] },
    ]);
    const table = parseMarkdown(md).tables[0];

    expect(table?.columns).toEqual(["Model", "Score", ""]);
    expect(table?.rows).toEqual([
      ["ours", "91.2", "±0.3"],
      ["theirs", "", ""],
    ]);
  });

  it("fences code longer than the code's own backticks", () => {
    const code = "const fence = ```;";
    const md = toMarkdown([{ kind: "code", text: code }]);
    expect(parseMarkdown(md).sections[0]?.text).toBe(code);
  });

  it("writes a destination containing a space in pointy brackets", () => {
    // An asset directory under `~/My Documents` is ordinary, and a bare
    // destination would stop at the first space — leaving a figure whose src is
    // half a path and which `fetchFigures` then drops.
    const md = toMarkdown([
      { kind: "image", src: "/tmp/My Documents/a.png", alt: "", caption: "c" },
    ]);
    expect(parseMarkdown(md).figures[0]?.src).toBe("/tmp/My Documents/a.png");
  });

  it("carries a video's page URL into the prose, where a link label would not", () => {
    const md = toMarkdown([
      {
        kind: "video",
        src: "",
        poster: "/assets/still.png",
        href: "https://youtu.be/abc123",
        caption: "The run, at 4x",
      },
    ]);
    const source = parseMarkdown(md);

    expect(source.figures[0]?.caption).toBe("The run, at 4x");
    // `textOf` drops a link's destination and keeps its children, so an autolink
    // is the only spelling whose URL survives into the section text.
    expect(source.sections[0]?.text).toContain("https://youtu.be/abc123");
  });
});

/* -------------------------------------------- Measurement, without Chrome */

describe("videoSize", () => {
  it("reads an mp4's box and a webm's track, and both durations", () => {
    expect(videoSize(mp4(1280, 720, 12))).toEqual({
      container: "mp4",
      width: 1280,
      height: 720,
      seconds: 12,
    });
    expect(videoSize(webm(640, 360, 5))).toEqual({
      container: "webm",
      width: 640,
      height: 360,
      seconds: 5,
    });
  });

  it("turns a portrait recording the right way up", () => {
    // The header says 1920x1080 and the matrix says a quarter turn, which is how
    // every phone writes portrait video. Believing the header alone hands layout
    // a 1.78 strip where the picture is a 0.56 portrait, and every fraction an
    // archetype takes against that box is then wrong.
    expect(videoSize(mp4(1920, 1080, 3, true))).toMatchObject({ width: 1080, height: 1920 });
  });

  it("refuses what a URL ending .mp4 actually served", () => {
    // The failure this exists for: a video URL that answers with a login wall.
    // Measuring it is how we find out before it is written into the deck.
    expect(() => videoSize(Buffer.from("<!doctype html><html>nope</html>"))).toThrow(
      /neither an ISO base media/,
    );
    // A container with only a sound track in it has no picture to place.
    expect(() => videoSize(mp4(0, 0, 4))).toThrow(/no track in it declares/);
  });
});

describe("attachClips", () => {
  it("upgrades the figure a poster made, and appends a clip that has none", async () => {
    const dir = await work();
    const poster = join(dir, "still-0f0f0f0f.png");
    const held = join(dir, "run-1a1a1a1a.mp4");
    const silent = join(dir, "second-2b2b2b2b.webm");
    await writeFile(poster, png(800, 450));
    await writeFile(held, mp4(1280, 720, 12));
    await writeFile(silent, webm(640, 360, 5));

    const parsed = parseMarkdown(
      toMarkdown([
        { kind: "heading", depth: 1, text: "Two videos" },
        { kind: "paragraph", text: "The run is shown in Figure 1." },
        { kind: "image", src: poster, alt: "", caption: "The run, at 4x" },
      ]),
    );
    const deck = join(dir, "deck");
    const source = await attachClips(
      parsed,
      [
        {
          file: held,
          poster,
          href: "",
          width: 1280,
          height: 720,
          seconds: 12,
          caption: "The run, at 4x",
        },
        { file: silent, poster: "", href: "", width: 640, height: 360, caption: "" },
      ],
      deck,
    );

    // The clip took over the poster's figure, which is what keeps the id, the
    // section and the sentence that mentions it — everything the planner uses to
    // decide where a picture belongs.
    expect(source.figures[0]).toEqual({
      id: parsed.figures[0]?.id,
      kind: "clip",
      src: basename(held),
      poster: basename(poster),
      caption: "The run, at 4x",
      width: 1280,
      height: 720,
      seconds: 12,
      sectionId: parsed.figures[0]?.sectionId,
      mention: "The run is shown in Figure 1.",
    });
    // And the one with no poster had nothing to take over, so it is appended
    // under an id nothing else holds.
    expect(source.figures[1]).toMatchObject({ id: "fig2", kind: "clip", src: basename(silent) });
    expect((await readdir(deck)).sort()).toEqual(
      [basename(held), basename(poster), basename(silent)].sort(),
    );

    // AND IT SURVIVES `fetchFigures`, which is the whole reason this runs before
    // it: a clip passes through untouched, so the local names above are what the
    // deck ends up pointing at.
    const localised = await fetchFigures(source, deck);
    expect(localised.figures.map((f) => f.src)).toEqual([basename(held), basename(silent)]);
  });

  it("is a no-op for a document that has no clips", async () => {
    const parsed = parseMarkdown("# A paper\n\nWith no videos in it at all.\n");
    expect(await attachClips(parsed, [], join(await work(), "deck"))).toBe(parsed);
  });
});

/* ------------------------------------------------------- The whole stage */

/**
 * No Chrome, no harvest — and no pretending otherwise. CI installs none, so
 * these are skipped there; the block above is what runs on every push.
 */
const chrome = await chromePath().catch(() => null);

describe.skipIf(chrome === null)("harvest, through a real browser", () => {
  const shut: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of shut.splice(0)) await close();
  });

  interface Route {
    type: string;
    body: string | Buffer;
  }

  /** A real server on an ephemeral loopback port, remembering what was asked of it. */
  async function serve(routes: Record<string, Route>) {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      hits.push(path);
      const route = routes[path];
      if (!route) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("no");
        return;
      }
      res.writeHead(200, { "content-type": route.type });
      res.end(route.body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    shut.push(
      () =>
        new Promise<void>((r) => {
          server.closeAllConnections();
          server.close(() => r());
        }),
    );
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, routes };
  }

  const local = { allowLoopback: true, timeoutMs: 30_000 };
  const html = (body: string): Route => ({ type: "text/html; charset=utf-8", body });

  it("becomes a document the rest of the pipeline reads without knowing it was a page", async () => {
    const one = await serve({
      "/paper": html(`<!doctype html><html><head><title>Sparse Attention | The Lab</title></head>
        <body>
          <nav><a href="/">Home</a> <a href="/about">About the lab</a></nav>
          <main>
            <h1>Sparse attention at scale</h1>
            <p>The method is summarised here.</p>
            <h2>Method</h2>
            <p>We compare against <a href="/baseline">the baseline</a> in Figure 1.</p>
            <figure>
              <img src="diagram.png" alt="the pipeline">
              <figcaption>Figure 1 — the pipeline, end to end</figcaption>
            </figure>
            <p>Text before <img src="/glyph.png" alt="an inline glyph"> and text after.</p>
            <ul><li>First point</li><li>Second point</li></ul>
            <ol><li>Step one</li><li>Step two</li></ol>
            <table>
              <tr><th>Model</th><th>Score</th></tr>
              <tr><td>ours</td><td>91.2</td></tr>
            </table>
            <pre><code>const x = 1;</code></pre>
          </main>
          <footer>Copyright the lab</footer>
        </body></html>`),
      "/diagram.png": { type: "image/png", body: png(640, 360) },
      "/glyph.png": { type: "image/png", body: png(128, 128) },
    });
    const dir = await work();

    const got = await harvest(`${one.base}/paper`, dir, local);

    expect(got.warnings).toEqual([]);
    // The `<h1>` inside the content, not `document.title` with the site's name
    // appended to it.
    expect(got.title).toBe("Sparse attention at scale");
    expect(got.markdown.startsWith("# Sparse attention at scale\n")).toBe(true);
    // Boilerplate, gone: the nav and footer are outside the content region and
    // are on the skip list besides.
    expect(got.markdown).not.toContain("About the lab");
    expect(got.markdown).not.toContain("Copyright the lab");
    expect(got.markdown).toContain("- First point");
    expect(got.markdown).toContain("1. Step one");
    expect(got.markdown).toContain("| Model | Score |");
    expect(got.markdown).toContain("const x = 1;");

    // The assets are real files with the served bytes in them.
    expect(got.assets).toHaveLength(2);
    expect((await readdir(dir)).sort()).toEqual(got.assets.map((a) => basename(a)).sort());
    expect(await readFile(got.assets[0] ?? "")).toEqual(png(640, 360));

    // AND THE POINT OF ALL OF IT: the document goes through ingest untouched.
    const parsed = parseMarkdown(got.markdown);
    expect(parsed.figures).toHaveLength(2);
    expect(parsed.figures[0]?.caption).toBe("Figure 1 — the pipeline, end to end");
    expect(parsed.figures[0]?.mention).toBe("We compare against the baseline in Figure 1.");
    // The inline image is the one a naive converter loses: `parseMarkdown` lifts
    // a figure only from a paragraph that is ALL images, so an image left inside
    // the sentence is silently discarded and the deck comes out text-only.
    expect(parsed.figures[1]?.caption).toBe("an inline glyph");
    const prose = parsed.sections.map((s) => s.text).join("\n");
    expect(prose).toContain("Text before");
    expect(prose).toContain("and text after.");

    // Measured off the bytes, which is what `naturalWidth` could never have said
    // with every subresource aborted.
    const source = await fetchFigures(parsed, join(dir, "deck"));
    expect(source.figures.map((f) => [f.width, f.height])).toEqual([
      [640, 360],
      [128, 128],
    ]);
  });

  it("makes no request of its own: every subresource on a second server is untouched", async () => {
    // THE OPEN-PROXY TEST. Everything the page references lives on `two`, which
    // serves nothing and only counts. If the browser fetched anything at all —
    // a stylesheet, a script, a tracking pixel in a region this never reads, an
    // iframe, a CSS background — `two.hits` is not empty, and this module is a
    // way to make requests from inside this network with a URL a stranger chose.
    const two = await serve({});
    const one = await serve({
      "/page": html(`<!doctype html><html><head>
          <link rel="stylesheet" href="${two.base}/style.css">
          <script src="${two.base}/app.js"></script>
        </head><body>
          <nav><img src="${two.base}/tracker.gif" alt="counted"></nav>
          <div style="background-image:url(${two.base}/bg.png);width:99px;height:99px"></div>
          <iframe src="${two.base}/frame.html"></iframe>
          <main>
            <h1>Beacons</h1>
            <p>Enough prose for this to be the content region of the page.</p>
            <p><img src="/figure.png" alt="the only image anybody fetches"></p>
          </main>
        </body></html>`),
      "/figure.png": { type: "image/png", body: png(320, 200) },
    });
    const dir = await work();

    const got = await harvest(`${one.base}/page`, dir, local);

    expect(two.hits).toEqual([]);
    // And the counter is not simply broken: the two fetches this module makes
    // ITSELF, through the guard, are both on the record.
    expect(one.hits).toEqual(["/page", "/figure.png"]);
    expect(parseMarkdown(got.markdown).figures).toHaveLength(1);
  });

  it("refuses a figure pointing at the metadata service, and keeps the rest of the page", async () => {
    const one = await serve({
      "/page": html(`<!doctype html><html><body><main>
          <h1>Nearly harmless</h1>
          <p>A paragraph long enough to make this the content region.</p>
          <p><img src="http://169.254.169.254/latest/meta-data/" alt="the metadata service"></p>
          <p>And the article continues afterwards.</p>
        </main></body></html>`),
    });
    const dir = await work();

    const got = await harvest(`${one.base}/page`, dir, local);

    // The guard names the address and the range, which is what makes the warning
    // worth reading. `allowLoopback` does not exempt link-local.
    expect(got.warnings).toHaveLength(1);
    expect(got.warnings[0]).toMatch(/the metadata service/);
    expect(got.warnings[0]).toMatch(/169\.254\.169\.254.*link-local/);
    expect(got.assets).toEqual([]);
    expect(parseMarkdown(got.markdown).figures).toEqual([]);
    expect(got.markdown).toContain("And the article continues afterwards.");
  });

  /** The page every video test below drives, with one of each shape on it. */
  const videos = () => ({
    "/page": html(`<!doctype html><html><head>
          <meta property="og:image" content="/social.png">
        </head><body><main>
          <h1>Four videos</h1>
          <p>A paragraph long enough to make this the content region of the page.</p>
          <figure>
            <video src="/clip.mp4" poster="/poster.png"></video>
            <figcaption>The run, at 4x</figcaption>
          </figure>
          <video><source src="/second.webm" type="video/webm"></video>
          <p><a href="https://youtu.be/abc123">Watch the talk</a></p>
          <iframe src="https://www.youtube.com/embed/xyz789" title="The talk, embedded"></iframe>
        </main></body></html>`),
    "/poster.png": { type: "image/png", body: png(800, 450) },
    "/social.png": { type: "image/png", body: png(1200, 630) },
    "/clip.mp4": { type: "video/mp4", body: mp4(1280, 720, 12) },
    "/second.webm": { type: "video/webm", body: webm(640, 360, 5) },
  });

  it("holds the video files, never the player pages, and measures what it holds", async () => {
    const one = await serve(videos());
    const dir = await work();

    const got = await harvest(`${one.base}/page`, dir, local);

    // THE POLICY, in one assertion. The two files are downloaded and measured
    // off their own containers; the two player pages are not fetched at all —
    // `policyFor` in src/pack/media.ts calls those `embed`, and downloading what
    // a YouTube link stands for is wrong and usually against its terms.
    expect(got.clips).toEqual([
      {
        file: expect.stringContaining("clip-"),
        poster: expect.stringContaining("poster-"),
        href: "",
        width: 1280,
        height: 720,
        seconds: 12,
        caption: "The run, at 4x",
      },
      {
        file: expect.stringContaining("second-"),
        poster: "",
        href: "",
        width: 640,
        height: 360,
        seconds: 5,
        caption: "",
      },
      {
        file: "",
        poster: expect.stringContaining("social-"),
        href: "https://youtu.be/abc123",
        width: 1200,
        height: 630,
        caption: "Watch the talk",
      },
    ]);
    // Nothing was asked of youtube.com, and the og:image was spent on the video
    // that had no still of its own AND no file — a clip we hold plays its own
    // frames and needs no poster, one we do not is nothing without one.
    expect(one.hits).toEqual(["/page", "/clip.mp4", "/poster.png", "/second.webm", "/social.png"]);

    // A clip we hold does not send the reader anywhere; the two we do not, do.
    expect(got.markdown).not.toContain(`${one.base}/clip.mp4`);
    expect(got.markdown).toContain("Video: <https://youtu.be/abc123>");
    expect(got.markdown).toContain("Video: <https://www.youtube.com/embed/xyz789>");
    expect(got.warnings.filter((w) => /player page/.test(w))).toHaveLength(1);
    // The fourth had no poster attribute and no og:image left to spend, so the
    // deck gets a line of prose where the page had a picture — said out loud.
    expect(got.warnings.some((w) => /gave it no still/.test(w))).toBe(true);
  });

  it("becomes three clip figures the rest of the pipeline can plan around", async () => {
    const one = await serve(videos());
    const dir = await work();

    const got = await harvest(`${one.base}/page`, dir, local);
    const deck = join(dir, "deck");
    // The order the CLI uses, and the order that matters: `attachClips` first,
    // because `fetchFigures` passes a clip through untouched.
    const source = await fetchFigures(
      await attachClips(parseMarkdown(got.markdown), got.clips, deck),
      deck,
    );

    expect(source.figures.map((f) => [f.kind, f.width, f.height, f.href])).toEqual([
      // The poster's figure, taken over by the clip whose still it was — so the
      // box is the VIDEO's 1280x720 and not the poster's 800x450.
      ["clip", 1280, 720, undefined],
      ["clip", 1200, 630, "https://youtu.be/abc123"],
      ["clip", 640, 360, undefined],
    ]);
    expect(source.figures[0]?.caption).toBe("The run, at 4x");
    // Every file a figure names is really beside the deck.
    const written = await readdir(deck);
    for (const figure of source.figures) {
      expect(written).toContain(figure.src);
      if (figure.poster) expect(written).toContain(figure.poster);
    }
  });

  it("downloads no video at all when told not to, and names the cap that stopped it", async () => {
    // The MCP's own budget: the server ingests a markdown document, which has no
    // way to say `kind: "clip"`, so fetching the mp4 would be megabytes pulled to
    // be thrown away at the upload.
    const one = await serve(videos());

    const got = await harvest(`${one.base}/page`, await work(), { ...local, maxClips: 0 });

    expect(one.hits).not.toContain("/clip.mp4");
    expect(got.clips.every((c) => c.file === "")).toBe(true);
    expect(got.warnings.some((w) => /maxClips is 0/.test(w))).toBe(true);
    // And the still survives, which is the whole point of not simply dropping it.
    expect(parseMarkdown(got.markdown).figures[0]?.caption).toBe("The run, at 4x");
  });

  it("stops at the byte budget, and charges it only for what arrived", async () => {
    const one = await serve({
      "/page": html(`<!doctype html><html><body><main>
          <h1>Two figures</h1>
          <p>A paragraph long enough to make this the content region of the page.</p>
          <p><img src="/first.png" alt="the first figure"></p>
          <p><img src="/second.png" alt="the second figure"></p>
        </main></body></html>`),
      "/first.png": { type: "image/png", body: png(700, 400) },
      "/second.png": { type: "image/png", body: png(700, 400) },
    });

    // One byte of budget buys the FIRST figure — the cap is checked before a
    // fetch and charged after it, so nothing is refused before anything has been
    // spent. It is the second that pays for the first.
    const got = await harvest(`${one.base}/page`, await work(), { ...local, maxTotalBytes: 1 });

    expect(got.assets).toHaveLength(1);
    expect(one.hits).toEqual(["/page", "/first.png"]);
    expect(got.warnings[0]).toMatch(/raise maxTotalBytes/);
  });

  it("keeps the still of a video the page names no source for", async () => {
    // A `<video poster>` with no `src` and no `<source>`: there is nothing to
    // play, but the picture is real and already downloaded, and dropping it
    // would throw away a figure the deck can use.
    const one = await serve({
      "/page": html(`<!doctype html><html><body><main>
          <h1>A still</h1>
          <p>A paragraph long enough to make this the content region of the page.</p>
          <figure>
            <video poster="/frame.png"></video>
            <figcaption>The rig, before it ran</figcaption>
          </figure>
        </main></body></html>`),
      "/frame.png": { type: "image/png", body: png(900, 500) },
    });

    const got = await harvest(`${one.base}/page`, await work(), local);

    expect(got.clips).toEqual([]);
    expect(got.warnings.some((w) => /is a still only/.test(w))).toBe(true);
    expect(parseMarkdown(got.markdown).figures.map((f) => f.caption)).toEqual([
      "The rig, before it ran",
    ]);
  });

  it("refuses a URL that answers with something that is not a page", async () => {
    const one = await serve({ "/paper.pdf": { type: "application/pdf", body: "%PDF-1.7" } });

    await expect(harvest(`${one.base}/paper.pdf`, await work(), local)).rejects.toThrow(
      /served application\/pdf/,
    );
  });

  it("finds the content in a page of undifferentiated divs", async () => {
    // No `<main>`, no `<article>`, and a sidebar that is nothing but links —
    // which is exactly what the link-density term in the score is for.
    const one = await serve({
      "/page": html(`<!doctype html><html><body>
          <div id="shell">
            <div id="rail">
              <a href="/1">Another paper about attention</a>
              <a href="/2">A third paper about attention</a>
              <a href="/3">A fourth paper about attention</a>
            </div>
            <div id="body">
              <h1>The densest container wins</h1>
              <p>This paragraph is prose rather than links, so it scores.</p>
              <p>So does this one, and together they outweigh the rail beside them.</p>
            </div>
          </div>
        </body></html>`),
    });

    const got = await harvest(`${one.base}/page`, await work(), local);

    expect(got.title).toBe("The densest container wins");
    expect(got.markdown).toContain("This paragraph is prose rather than links");
    expect(got.markdown).not.toContain("Another paper about attention");
  });

  it("drops a tracking pixel rather than planning a slide around it", async () => {
    const one = await serve({
      "/page": html(`<!doctype html><html><body><main>
          <h1>Furniture</h1>
          <p>A paragraph long enough to make this the content region of the page.</p>
          <p><img src="/spacer.gif" alt="spacer"></p>
          <p><img src="/real.png" alt="the actual figure"></p>
        </main></body></html>`),
      "/spacer.gif": { type: "image/gif", body: png(1, 1) },
      "/real.png": { type: "image/png", body: png(700, 400) },
    });
    const dir = await work();

    const got = await harvest(`${one.base}/page`, dir, local);

    expect(got.assets).toHaveLength(1);
    expect(got.warnings[0]).toMatch(/1x1, under 64px/);
    expect(parseMarkdown(got.markdown).figures.map((f) => f.caption)).toEqual([
      "the actual figure",
    ]);
  });
});
