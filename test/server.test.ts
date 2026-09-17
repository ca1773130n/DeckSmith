/**
 * The server's pure parts, and its routes with the pipeline stubbed out.
 *
 * NOTHING HERE REACHES THE NETWORK, spawns Codex, or opens a browser. The one
 * seam that makes that possible is `ServeOptions.run` — the same injection
 * `codexPlanner` and `planMedia` already use — so a POST can be driven all the
 * way to a served file without a job costing anyone money.
 *
 * The zip tests are the ones that matter most. A zip-slip finding is not a
 * theory here: `readZip` is handed an archive with a real `../../../etc/passwd`
 * entry, and the test asserts both that it is refused BY NAME and that the
 * sibling directory it aimed at is still empty afterwards.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request,
  type Server,
} from "node:http";
import { request as httpsRequest, type Server as TlsServer } from "node:https";
import { type AddressInfo, connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createSecureContext, connect as tlsConnect } from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { zipSync } from "fflate";
import type { Browser, BrowserContext, Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { toolSvg } from "../src/images/providers.js";
import { FORMATS, LEGIBLE_W, MAX_ASPECT, MIN_EDGE, parseMarkdown } from "../src/index.js";
import { EMBED_ORIGINS } from "../src/pack/media.js";
import { chromePath } from "../src/render/capture.js";
import {
  authKeys,
  cookieName,
  mintSession,
  resolveSecurity,
  type Security,
  type SecurityDeps,
  SecurityRefusal,
  securityBanner,
  sessionBinding,
  TLS_MIN_VERSION,
  type TlsMaterial,
} from "../src/server/auth.js";
import { explain } from "../src/server/errors.js";
import {
  createDeckServer,
  parseRange,
  RateLimiter,
  type ServeOptions,
  safeUrlPath,
} from "../src/server/http.js";
import { catalog, MAX_PIXELS, parseOptions } from "../src/server/options.js";
import { guardFigures, stagesFor } from "../src/server/pipeline.js";
import { type JobHandle, type JobResult, Queue, QueueFullError } from "../src/server/queue.js";
import { uiPage } from "../src/server/ui.js";
import {
  looksLikeZip,
  parseSubmission,
  pickMarkdown,
  readBody,
  readZip,
  safeEntryPath,
  type Upload,
  UploadError,
} from "../src/server/upload.js";

const bytes = (s: string) => new TextEncoder().encode(s);
const execFileP = promisify(execFile);

/**
 * The renderer's Chrome, or null. No Chrome, no pass — and no pretending
 * otherwise: the suites that need it are skipped, as in test/deck-page.test.ts.
 */
const chrome = await chromePath().catch(() => null);
const scratch = async () => mkdtemp(join(tmpdir(), "decksmith-server-"));

/* ------------------------------------------------------------------ multipart */

/** A multipart body built by hand, so the parser is tested and not a client. */
function multipart(
  parts: { name: string; value: string; filename?: string; type?: string }[],
  boundary = "----DeckSmithTest",
): { body: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    // `!== undefined`, not truthiness: `filename=""` is exactly what a browser
    // writes for an <input type=file> nobody chose a file with, and that empty
    // string still has to arrive as a FILE part rather than as a scalar field.
    const named = part.filename !== undefined;
    const disposition = named
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    const type = named ? `\r\nContent-Type: ${part.type ?? "text/markdown"}` : "";
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}${type}\r\n\r\n`, "utf8"),
      Buffer.from(part.value, "utf8"),
      Buffer.from("\r\n", "utf8"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** The file arm, narrowed, so a test can read `.upload` without a cast. */
async function parseFile(body: Buffer, contentType: string): Promise<Upload> {
  const sub = await parseSubmission(body, contentType);
  if (sub.kind !== "file") throw new Error(`expected a file submission, got ${sub.kind}`);
  return sub.upload;
}

describe("multipart", () => {
  it("reads the file part and the scalar fields", async () => {
    const { body, contentType } = multipart([
      { name: "file", value: "# Title\n\nSome prose.\n", filename: "a paper.md" },
      { name: "format", value: "short-9x16" },
      { name: "slides", value: "7" },
    ]);
    const upload = await parseFile(body, contentType);
    expect(upload.filename).toBe("a paper.md");
    expect(new TextDecoder().decode(upload.bytes)).toBe("# Title\n\nSome prose.\n");
    expect(upload.fields).toEqual({ format: "short-9x16", slides: "7" });
  });

  it("keeps UTF-8 intact", async () => {
    const { body, contentType } = multipart([
      { name: "file", value: "# 한글 제목\n\néé\n", filename: "ko.md" },
    ]);
    const upload = await parseFile(body, contentType);
    expect(new TextDecoder().decode(upload.bytes)).toContain("한글 제목");
  });

  it("names the missing part rather than throwing a TypeError", async () => {
    const { body, contentType } = multipart([{ name: "format", value: "deck-16x9" }]);
    await expect(parseSubmission(body, contentType)).rejects.toThrow(
      /neither a "file" part nor a "url" field/,
    );
  });

  it("refuses a body that is not multipart", async () => {
    await expect(parseSubmission(Buffer.from("{}"), "application/json")).rejects.toThrow(
      /takes a multipart/,
    );
  });

  it("says so when the file part is empty", async () => {
    const { body, contentType } = multipart([{ name: "file", value: "", filename: "empty.md" }]);
    await expect(parseSubmission(body, contentType)).rejects.toThrow(/is empty/);
  });

  it("reads a url submission and keeps the option fields with it", async () => {
    const { body, contentType } = multipart([
      { name: "url", value: " https://example.com/paper " },
      { name: "format", value: "short-9x16" },
    ]);
    const sub = await parseSubmission(body, contentType);
    expect(sub.kind).toBe("url");
    // Trimmed, because a pasted link brings whitespace with it more often than not.
    expect(sub.kind === "url" && sub.url).toBe("https://example.com/paper");
    expect(sub.fields.format).toBe("short-9x16");
  });

  it("refuses a request carrying both, and names both halves", async () => {
    const { body, contentType } = multipart([
      { name: "file", value: "# P\n", filename: "p.md" },
      { name: "url", value: "https://example.com/paper" },
    ]);
    await expect(parseSubmission(body, contentType)).rejects.toThrow(
      /both a "file" part and a "url" field/,
    );
  });

  /**
   * THE PART A BROWSER SENDS WHEN NOTHING WAS CHOSEN. An `<input type=file>` with
   * no selection still serialises — as a File with no name and no bytes — so a
   * form offering a file OR a url posts the pair on every URL job. Without this,
   * both of this server's own pages would refuse every link they submitted.
   */
  it("does not read an unselected file input as a file", async () => {
    const { body, contentType } = multipart([
      { name: "file", value: "", filename: "", type: "application/octet-stream" },
      { name: "url", value: "https://example.com/paper" },
    ]);
    const sub = await parseSubmission(body, contentType);
    expect(sub.kind).toBe("url");
  });

  it("refuses a url it will not fetch, before a job is ever made", async () => {
    const bad: [string, RegExp][] = [
      ["file:///etc/passwd", /"file:" addresses are not fetched/],
      ["ftp://example.com/x", /"ftp:" addresses are not fetched/],
      ["not a url at all", /is not a URL/],
      [`https://example.com/${"a".repeat(3000)}`, /characters long/],
    ];
    for (const [value, message] of bad) {
      const { body, contentType } = multipart([{ name: "url", value }]);
      await expect(parseSubmission(body, contentType)).rejects.toThrow(message);
    }
  });

  it("stops reading at the cap instead of buffering the whole upload", async () => {
    const stream = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(readBody(stream as never, 1000)).rejects.toMatchObject({ status: 413 });
  });

  it("reads a body under the cap", async () => {
    const stream = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
    expect((await readBody(stream as never, 1000)).toString()).toBe("abcd");
  });
});

/* ------------------------------------------------------------------ zip safety */

describe("zip entry names", () => {
  const rejected = [
    "../../etc/passwd",
    "..\\..\\windows\\system32\\x",
    "/etc/passwd",
    "C:\\Windows\\x",
    "a/../../b",
    "foo/\0/bar",
    "",
    "././..",
    `${"a".repeat(300)}/x`,
  ];
  for (const name of rejected) {
    it(`refuses ${JSON.stringify(name)}`, () => {
      expect(safeEntryPath(name)).toBeNull();
    });
  }

  const kept: [string, string][] = [
    ["paper.md", "paper.md"],
    ["./paper.md", "paper.md"],
    ["figures/fig1.png", "figures/fig1.png"],
    ["a//b/c.png", "a/b/c.png"],
    ["a/./b.md", "a/b.md"],
  ];
  for (const [name, want] of kept) {
    it(`keeps ${JSON.stringify(name)} as ${want}`, () => {
      expect(safeEntryPath(name)).toBe(want);
    });
  }
});

describe("readZip", () => {
  it("refuses an archive holding a traversal, and names the entry", () => {
    const zip = zipSync({
      "paper.md": bytes("# Ok\n"),
      "../../../etc/passwd": bytes("root::0:0\n"),
    });
    expect(() => readZip(zip)).toThrow(/escape its directory.*\.\.\/\.\.\/\.\.\/etc\/passwd/s);
  });

  it("REALLY does not write outside the job directory", async () => {
    // The proof, not the promise: extract into <scratch>/job and then look at
    // <scratch> for anything the archive tried to plant beside it.
    const root = await scratch();
    const job = join(root, "job");
    await writeFile(join(root, ".keep"), "");
    const zip = zipSync({
      "paper.md": bytes("# Ok\n"),
      "../pwned.txt": bytes("owned"),
    });
    expect(() => readZip(zip)).toThrow(UploadError);

    // And the benign archive that remains extracts only under `job`.
    const safe = readZip(zipSync({ "paper.md": bytes("# Ok\n"), "fig/a.png": bytes("x") }));
    const { mkdir } = await import("node:fs/promises");
    for (const [rel, data] of Object.entries(safe.files)) {
      await mkdir(join(job, rel, ".."), { recursive: true });
      await writeFile(join(job, rel), data);
    }
    expect((await readdir(root)).sort()).toEqual([".keep", "job"]);
    expect((await readdir(job)).sort()).toEqual(["fig", "paper.md"]);
  });

  it("caps the entry count", () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 12; i++) many[`f${i}.md`] = bytes("#");
    expect(() =>
      readZip(zipSync(many), { maxEntries: 5, maxTotalBytes: 1e9, maxEntryBytes: 1e9 }),
    ).toThrow(/more than 5 files/);
  });

  it("caps the DECOMPRESSED total, which the upload cap cannot", () => {
    // 5 MB of zeros deflates to about 5 KB — a 946:1 ratio measured on this
    // machine. The upload limit would wave it through; this is what does not.
    const zip = zipSync({ "big.bin": new Uint8Array(5_000_000) }, { level: 6 });
    expect(zip.length).toBeLessThan(50_000);
    expect(() =>
      readZip(zip, { maxEntries: 100, maxTotalBytes: 1_000_000, maxEntryBytes: 10_000_000 }),
    ).toThrow(/unpacks to more than 1 MB/);
  });

  it("caps a single large entry", () => {
    const zip = zipSync({ "big.bin": new Uint8Array(5_000_000) }, { level: 6 });
    expect(() =>
      readZip(zip, { maxEntries: 100, maxTotalBytes: 1e9, maxEntryBytes: 1_000_000 }),
    ).toThrow(/over the 1 MB per-file limit/);
  });

  it("cannot be tricked by a header that understates a member's size", () => {
    // MEASURED: fflate allocates exactly the declared uncompressed size and
    // truncates the inflate to it, so a lying header costs 10 bytes of memory
    // rather than 5 MB. If that ever stops being true this test fails, which is
    // the point of writing it against a hand-patched archive.
    const zip = Uint8Array.from(zipSync({ "big.bin": new Uint8Array(5_000_000) }, { level: 6 }));
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let patched = 0;
    for (let i = 0; i + 4 <= zip.length; i++) {
      if (view.getUint32(i, true) === 5_000_000) {
        view.setUint32(i, 10, true);
        patched++;
      }
    }
    expect(patched).toBe(2); // local header and central directory
    const out = readZip(zip);
    expect(out.files["big.bin"]?.length).toBe(10);
  });

  it("drops archive litter without counting it", () => {
    const zip = zipSync({
      "__MACOSX/._paper.md": bytes("junk"),
      ".DS_Store": bytes("junk"),
      "paper.md": bytes("# Ok\n"),
    });
    expect(Object.keys(readZip(zip).files)).toEqual(["paper.md"]);
  });

  it("refuses an empty archive", () => {
    expect(() => readZip(zipSync({ "empty/": new Uint8Array(0) }))).toThrow(/archive is empty/);
  });

  it("recognises a zip by its magic, not its name", () => {
    expect(looksLikeZip(zipSync({ "a.md": bytes("#") }))).toBe(true);
    expect(looksLikeZip(bytes("# not a zip"))).toBe(false);
  });
});

describe("pickMarkdown", () => {
  const files = (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, bytes("#")])) as Record<string, Uint8Array>;

  it("prefers the shallowest", () => {
    expect(pickMarkdown(files("deep/nested/a.md", "top.md"))).toBe("top.md");
  });

  it("prefers a name that says so at the same depth", () => {
    expect(pickMarkdown(files("zebra.md", "paper.md"))).toBe("paper.md");
  });

  it("falls back to alphabetical", () => {
    expect(pickMarkdown(files("b.md", "a.md"))).toBe("a.md");
  });

  it("takes .markdown and .txt too", () => {
    expect(pickMarkdown(files("notes.txt"))).toBe("notes.txt");
  });

  it("says what is missing when there is no markdown", () => {
    expect(() => pickMarkdown(files("fig1.png", "data.csv"))).toThrow(/no \.md/);
  });
});

/* --------------------------------------------------------------------- options */

describe("parseOptions", () => {
  it("needs nothing", () => {
    const o = parseOptions({});
    expect(o.formatId).toBe("deck-16x9");
    expect(o.format.width).toBe(1920);
    expect(o.narrate).toBe(false);
    expect(o.video).toBe(false);
    expect(o.images).toBe(false);
    expect(o.prefs.theme).toBe("ink");
    expect(o.stated).toEqual({ theme: false, lang: false });
  });

  /**
   * One bit, two readers. `stagesFor` decides whether the `illustrate` row
   * exists from the copy on the options; the planner decides whether it may
   * write a brief from the copy in the preferences. A request that set only one
   * would either plan pictures nobody draws or run a stage with nothing to do.
   */
  it("reads illustrations into both the stage list and the planner's preferences", () => {
    const on = parseOptions({ images: "on" });
    expect(on.images).toBe(true);
    expect(on.prefs.images.enabled).toBe(true);
    // Provider, style and model are the deployment's, never the form's — and the
    // deployment's default is the Codex account, so a form that ticks the box
    // cannot reach a metered backend without someone naming it on the server.
    expect(on.prefs.images.provider).toBe("codex");
    expect(parseOptions({ images: "false" }).prefs.images.enabled).toBe(false);
    expect(() => parseOptions({ images: "maybe" })).toThrow(/yes or no/);
  });

  it("publishes the illustration default and names the backend by id only", () => {
    const c = catalog() as { defaults: Record<string, unknown>; images: { backend: unknown } };
    expect(c.defaults.images).toBe(false);
    // `null` or an id — whatever this machine's environment names. Never a key,
    // and never a throw: the picker reads this before anyone asks for a picture.
    expect(c.images.backend === null || typeof c.images.backend === "string").toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/API_KEY|sk-/);
  });

  it("records that a preference was actually chosen", () => {
    expect(parseOptions({ theme: "mono", lang: "ko" }).stated).toEqual({ theme: true, lang: true });
  });

  it("names the formats it knows", () => {
    expect(() => parseOptions({ format: "imax" })).toThrow(/Unknown format "imax"/);
    expect(() => parseOptions({ format: "imax" })).toThrow(UploadError);
  });

  it("overrides the canvas, keeping the preset's pacing but not its name", () => {
    const o = parseOptions({ format: "post-1x1", width: "1200", height: "1200" });
    // RENAMED, because the id is quoted in cut explanations and in the budget
    // gate. `post-1x1` printed over a canvas that is not 1080x1080 is a lie.
    expect(o.format.id).toBe("custom-1200x1200");
    expect([o.format.width, o.format.height]).toEqual([1200, 1200]);
    expect(o.format.maxSeconds).toBe(140); // still bound by where a square post goes
    expect(o.format.minWeight).toBe(FORMATS["post-1x1"]?.minWeight);
    // The REQUEST still named a preset, and that is what the log and the job
    // view report — the two ids answer different questions.
    expect(o.formatId).toBe("post-1x1");
  });

  it("returns the preset itself when the canvas is the one it already had", () => {
    const o = parseOptions({ format: "short-9x16", width: "1080", height: "1920" });
    expect(o.format).toBe(FORMATS["short-9x16"]);
    expect(o.format.id).toBe("short-9x16");
  });

  it("wants width and height together", () => {
    expect(() => parseOptions({ width: "1200" })).toThrow(/together/);
  });

  it("rounds an odd side down and says so", () => {
    const o = parseOptions({ width: "1281", height: "720" });
    expect(o.format.width).toBe(1280);
    expect(o.warnings.join(" ")).toMatch(/h264 needs even/);
  });

  it("refuses a canvas that would not fit in memory", () => {
    expect(() => parseOptions({ width: "2560", height: "2560" })).toThrow(/megapixel ceiling/);
    expect(() => parseOptions({ width: "10000", height: "10000" })).toThrow(/megapixel ceiling/);
  });

  /**
   * ONE SET OF CANVAS RULES, NOT THREE. src/types.ts derives them, this file adds
   * only a megapixel ceiling, and ui.ts interpolates both. Before reconciling,
   * the server refused 320..2560 while the page's own number inputs offered
   * 240..7680 — so the picker's stated maximum came back 400.
   */
  it("delegates canvas legality to the library's derived rules", () => {
    // Below MIN_EDGE, with the layout reason rather than an invented bound.
    expect(() => parseOptions({ width: "32", height: "32" })).toThrow(/below 64px/);
    // Past MAX_ASPECT, in both directions.
    expect(() => parseOptions({ width: "4000", height: "300" })).toThrow(/too wide/);
    expect(() => parseOptions({ width: "300", height: "4000" })).toThrow(/too tall/);
    // A whole number of pixels.
    expect(() => parseOptions({ width: "1920.5", height: "1080" })).toThrow(/whole number/);
    // No leading `--`: these sentences are shared with the CLI, which spells
    // them as flags, and an HTTP field is not a flag.
    expect(() => parseOptions({ width: "32", height: "32" })).toThrow(/^(?!.*--width)/s);
  });

  it("publishes exactly the canvas bounds it enforces", () => {
    const canvas = catalog().canvas as Record<string, number | undefined>;
    const maxSide = canvas.maxSide as number;
    const maxAspect = canvas.maxAspect as number;
    const maxPixels = canvas.maxPixels as number;
    expect(canvas.minSide).toBe(MIN_EDGE);
    expect(maxPixels).toBe(MAX_PIXELS);
    expect(maxAspect).toBe(MAX_ASPECT);
    // THE ADVERTISED LONGEST EDGE MUST BE BUILDABLE, at an EVEN partner height —
    // `even()` rounds an odd side down, which raises the aspect ratio, so a
    // maximum whose only legal partner is odd is refused at every height. 5656
    // was such a number before this was pinned.
    const shortest = Math.ceil(maxSide / maxAspect);
    expect(shortest % 2).toBe(0);
    expect(maxSide * shortest).toBeLessThanOrEqual(maxPixels);
    const o = parseOptions({ width: String(maxSide), height: String(shortest) });
    expect([o.format.width, o.format.height]).toEqual([maxSide, shortest]);
  });

  it("says a legal but illegible canvas is legal, and warns", () => {
    const o = parseOptions({ width: "640", height: "360" });
    expect(o.format.width).toBe(640);
    expect(o.warnings.join(" ")).toMatch(/under 960px/);
  });

  it("lets the schema judge what the schema knows", () => {
    expect(() => parseOptions({ slides: "2" })).toThrow(/slides/);
    expect(() => parseOptions({ slides: "41" })).toThrow(/slides/);
    expect(() => parseOptions({ tone: "shouty" })).toThrow(/tone/);
    expect(() => parseOptions({ speed: "9" })).toThrow(/animationSpeed/);
    expect(() => parseOptions({ theme: "neon" })).toThrow(/Unknown theme/);
  });

  it("turns narration on for a video, because render needs its timing", () => {
    const o = parseOptions({ video: "true" });
    expect(o.narrate).toBe(true);
    expect(o.warnings.join(" ")).toMatch(/needs narration/);
    expect(stagesFor(o)).toEqual(["ingest", "plan", "narrate", "build", "render"]);
  });

  it("plans only the stages it will run", () => {
    expect(stagesFor(parseOptions({}))).toEqual(["ingest", "plan", "build"]);
    expect(stagesFor(parseOptions({ narrate: "on" }))).toEqual([
      "ingest",
      "plan",
      "narrate",
      "build",
    ]);
    // Illustrations sit between the plan that asks for them and the narration
    // that may describe them; the row is there only when the box was ticked.
    expect(stagesFor(parseOptions({ images: "on" }))).toEqual([
      "ingest",
      "plan",
      "illustrate",
      "build",
    ]);
    expect(stagesFor(parseOptions({ images: "on", video: "on" }))).toEqual([
      "ingest",
      "plan",
      "illustrate",
      "narrate",
      "build",
      "render",
    ]);
  });

  it("reads a checkbox and a boolean alike, and refuses neither", () => {
    expect(parseOptions({ narrate: "on" }).narrate).toBe(true);
    expect(parseOptions({ narrate: "false" }).narrate).toBe(false);
    expect(() => parseOptions({ narrate: "maybe" })).toThrow(/yes or no/);
  });

  it("refuses junk where a voice or a language tag goes", () => {
    expect(() => parseOptions({ voice: "; rm -rf /" })).toThrow(/edge-tts voice id/);
    expect(() => parseOptions({ lang: "../../etc" })).toThrow(/language tag/);
    expect(parseOptions({ voice: "en-US-AvaMultilingualNeural" }).prefs.narration.voice).toBe(
      "en-US-AvaMultilingualNeural",
    );
  });
});

/* ----------------------------------------------------------------------- queue */

describe("Queue", () => {
  /** A job that finishes when the test says so. */
  function controllable(): {
    run: (h: JobHandle) => Promise<JobResult>;
    started: Promise<JobHandle>;
    finish: (r?: Partial<JobResult>) => void;
    fail: (e: Error) => void;
  } {
    let onStart!: (h: JobHandle) => void;
    const started = new Promise<JobHandle>((r) => {
      onStart = r;
    });
    let settle!: { resolve: (r: JobResult) => void; reject: (e: Error) => void };
    const run = (h: JobHandle) => {
      onStart(h);
      return new Promise<JobResult>((resolve, reject) => {
        settle = { resolve, reject };
      });
    };
    return {
      run,
      started,
      finish: (r = {}) =>
        settle.resolve({ deckUrl: "/d/x/deck.html", slides: 3, duration: 10, warnings: [], ...r }),
      fail: (e) => settle.reject(e),
    };
  }

  const stages = ["ingest", "plan", "build"] as const;

  it("runs one at a time and reports the place in line", async () => {
    const queue = new Queue();
    const a = controllable();
    const b = controllable();
    queue.submit({ id: "a", dir: "/tmp/a", stages: [...stages], run: a.run });
    queue.submit({ id: "b", dir: "/tmp/b", stages: [...stages], run: b.run });
    await a.started;

    expect(queue.view("a")?.state).toBe("running");
    expect(queue.view("a")?.queuePosition).toBeUndefined();
    expect(queue.view("b")?.state).toBe("queued");
    expect(queue.view("b")?.queuePosition).toBe(1);
    expect(queue.depth).toBe(1);

    a.finish();
    await b.started;
    expect(queue.view("a")?.state).toBe("done");
    expect(queue.view("b")?.state).toBe("running");
    expect(queue.view("b")?.queuePosition).toBeUndefined();
    b.finish();
  });

  it("refuses rather than promising position four hundred", () => {
    const queue = new Queue({ maxQueued: 1 });
    const a = controllable();
    queue.submit({ id: "a", dir: "/tmp/a", stages: [...stages], run: a.run });
    queue.submit({ id: "b", dir: "/tmp/b", stages: [...stages], run: controllable().run });
    expect(() =>
      queue.submit({ id: "c", dir: "/tmp/c", stages: [...stages], run: controllable().run }),
    ).toThrow(QueueFullError);
  });

  it("walks the steps and times them", async () => {
    let clock = 1000;
    const queue = new Queue({ now: () => clock });
    const a = controllable();
    queue.submit({ id: "a", dir: "/tmp/a", stages: [...stages], run: a.run });
    const handle = await a.started;

    expect(queue.view("a")?.steps.map((s) => s.state)).toEqual(["pending", "pending", "pending"]);
    handle.begin("ingest");
    clock += 250;
    handle.done("ingest", "3 sections");
    const view = queue.view("a") as NonNullable<ReturnType<Queue["view"]>>;
    expect(view.stage).toBe("ingest");
    expect(view.steps[0]).toMatchObject({ state: "done", ms: 250, detail: "3 sections" });
    expect(view.log).toContain("ingest: started");

    handle.begin("plan");
    handle.skip("build", "nothing to build");
    expect(queue.view("a")?.steps.map((s) => s.state)).toEqual(["done", "running", "skipped"]);
    a.finish({ slides: 9 });
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.view("a")?.result?.slides).toBe(9);
    expect(queue.view("a")?.state).toBe("done");
  });

  it("marks the stage that was mid-flight when it failed, and explains it", async () => {
    const queue = new Queue();
    const a = controllable();
    queue.submit({ id: "a", dir: "/tmp/a", stages: [...stages], run: a.run });
    const handle = await a.started;
    handle.begin("plan");
    a.fail(new Error('The "codex" CLI is not on PATH. Install it, or sign in with `codex login`.'));
    await new Promise((r) => setTimeout(r, 0));

    const view = queue.view("a") as NonNullable<ReturnType<Queue["view"]>>;
    expect(view.state).toBe("error");
    expect(view.steps.find((s) => s.name === "plan")?.state).toBe("error");
    expect(view.error?.message).toMatch(/not on PATH/);
    expect(view.error?.hint).toMatch(/codex login/);
  });

  it("keeps the tail of a long log and says how much it dropped", async () => {
    const queue = new Queue({ maxLog: 5 });
    const a = controllable();
    queue.submit({ id: "a", dir: "/tmp/a", stages: [...stages], run: a.run });
    const handle = await a.started;
    for (let i = 0; i < 20; i++) handle.log(`line ${i}`);
    const log = queue.view("a")?.log ?? [];
    expect(log).toHaveLength(6); // 5 kept plus the "dropped" notice
    expect(log[0]).toMatch(/earlier line\(s\) dropped/);
    expect(log.at(-1)).toBe("line 19");
    a.finish();
  });

  it("sweeps finished jobs on the TTL and never a running one", async () => {
    let clock = 0;
    const gone: string[] = [];
    const queue = new Queue({ ttlMs: 1000, now: () => clock, onExpire: (id) => gone.push(id) });
    const a = controllable();
    const b = controllable();
    queue.submit({ id: "a", dir: "/tmp/a", stages: [...stages], run: a.run });
    queue.submit({ id: "b", dir: "/tmp/b", stages: [...stages], run: b.run });
    await a.started;
    a.finish();
    await b.started;

    clock = 5000;
    expect(queue.sweep()).toEqual(["a"]);
    expect(gone).toEqual(["a"]);
    expect(queue.view("a")).toBeUndefined();
    expect(queue.view("b")?.state).toBe("running"); // old, but working
    b.finish();
  });

  it("tells a watcher about every change and stops when told", async () => {
    const queue = new Queue();
    const a = controllable();
    queue.submit({ id: "a", dir: "/tmp/a", stages: [...stages], run: a.run });
    const seen: string[] = [];
    const stop = queue.watch("a", (v) => seen.push(v.state));
    const handle = await a.started;
    handle.log("hello");
    stop();
    handle.log("unheard");
    expect(seen).toEqual(["running"]);
  });
});

/* ---------------------------------------------------------------------- errors */

describe("explain", () => {
  const cases: [string, RegExp][] = [
    ['The "codex" CLI is not on PATH.', /codex login/],
    ["edge-tts is not installed, so narration cannot be synthesised.", /pip install/],
    ["Codex did not finish within 600s.", /Split it/],
    ["timing.json is missing. `render` needs the timing manifest", /narration on/],
    ["run `npx puppeteer browsers install chrome`", /DECKSMITH_CHROME/],
    ["spawn ffprobe ENOENT", /install ffmpeg/i],
    // The image backend's failures, as src/images/providers.ts shapes them.
    ["openai images: HTTP 401 (invalid_api_key)", /DECKSMITH_IMAGES_API_KEY/],
    ["openai images: HTTP 403 (forbidden)", /DECKSMITH_IMAGES_API_KEY/],
    ["openai images: HTTP 429 (rate_limit_exceeded)", /quota/],
    ["codex could not generate a picture: no image tool on this account", /SVG/],
    [
      "DECKSMITH_IMAGES=openai needs DECKSMITH_IMAGES_API_KEY. Set it, or unset",
      /illustrations off/,
    ],
    ['Unknown image backend "dalle". DECKSMITH_IMAGES accepts: openai.', /illustrations off/],
    ["Codex asked for 2 illustrations (b01, b03) with images off.", /Illustrations/],
  ];
  for (const [message, hint] of cases) {
    it(`hints at the fix for "${message.slice(0, 32)}…"`, () => {
      expect(explain(new Error(message)).hint).toMatch(hint);
    });
  }

  it("keeps the library's own sentence and never a stack", () => {
    const err = new Error("Cannot read source file paper.json.\n    at foo (bar.ts:1:1)");
    expect(explain(err).message).toBe("Cannot read source file paper.json.");
  });

  it("passes an upload error's own hint through", () => {
    expect(explain(new UploadError("no.", "do this."))).toEqual({
      message: "no.",
      hint: "do this.",
    });
  });

  it("admits when it has nothing useful to add", () => {
    expect(explain(new Error("something odd")).hint).toMatch(/not a document problem/);
  });
});

/* ------------------------------------------------------------------ URL safety */

describe("safeUrlPath", () => {
  it("keeps an ordinary path", () => {
    expect(safeUrlPath("/assets/fig1.png")).toBe("assets/fig1.png");
    expect(safeUrlPath("/")).toBe("");
  });

  it("refuses traversal, including the percent-encoded kind", () => {
    // %2e%2e%2f survives WHATWG URL normalisation, so the decode has to happen
    // before the segments are judged — which is what this asserts.
    expect(safeUrlPath("/%2e%2e/secret")).toBeNull();
    expect(safeUrlPath("/../secret")).toBeNull();
    expect(safeUrlPath("/a/%2e%2e%2f%2e%2e%2fetc/passwd")).toBeNull();
    expect(safeUrlPath("/a/%00b")).toBeNull();
    expect(safeUrlPath("/a/%zz")).toBeNull();
  });

  it("decodes a legitimately encoded name", () => {
    expect(safeUrlPath("/a%20b.png")).toBe("a b.png");
  });
});

describe("parseRange", () => {
  it("reads the forms a browser sends", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=2000-", 1000)).toBe("unsatisfiable");
  });
});

describe("RateLimiter", () => {
  it("counts per key inside a window and forgets after it", () => {
    let clock = 0;
    const limiter = new RateLimiter(2, 100, () => clock);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.take("b")).toBe(true);
    clock = 200;
    expect(limiter.take("a")).toBe(true);
  });

  /** Read-only: asking must not spend, or checking before comparing would itself be a failure. */
  it("says whether a key is exhausted without spending, per key and per window", () => {
    let clock = 0;
    const limiter = new RateLimiter(2, 100, () => clock);
    expect(limiter.blocked("a")).toBe(false);
    limiter.take("a");
    expect(limiter.blocked("a")).toBe(false);
    limiter.take("a");
    expect(limiter.blocked("a")).toBe(true);
    expect(limiter.blocked("a")).toBe(true);
    expect(limiter.blocked("b")).toBe(false);
    expect(limiter.take("b")).toBe(true);
    clock = 100;
    expect(limiter.blocked("a")).toBe(false);
  });
});

/* ------------------------------------------------------------ server helpers */

/**
 * A token, and the keys a server built from it holds. It starts with SENTINEL so
 * the log and banner tests can search every line for it.
 */
const TOKEN = `SENTINEL-${"k".repeat(35)}`;
const KEYS = authKeys(TOKEN);
const BEARER = { authorization: `Bearer ${TOKEN}` };

/* ------------------------------------------------------------- TLS, made here */

/**
 * The certificates and keys these tests need, MADE AT TEST TIME.
 *
 * They used to be three committed `.key` files under test/fixtures/tls/. They
 * were test-only and protected nothing, and it did not matter: a private key in
 * the repository is a private key in every clone, in every fork, and in every
 * secret scanner's report — GitGuardian failed this branch's CI on all three,
 * and it was right to. A scanner that has to be taught which keys are pretend is
 * a scanner nobody reads.
 *
 * So `openssl` makes them, once per run, into a directory under TMPDIR that
 * `afterAll` removes. Three pieces, matching what the tests need:
 *
 *   - `server.crt`/`server.key`: the pair an https server here starts with. SANs
 *     deck.test, *.wild.test, 127.0.0.1 and ::1, valid 100 years. Its CN is
 *     `cn-only.test` ON PURPOSE — a name that is NOT a SAN — so the Host tests
 *     prove the allowlist ignores the subject;
 *   - `cn-only.crt`/`cn-only.key`: a common name and no subjectAltName, which
 *     browsers reject and `resolveSecurity` refuses;
 *   - `other.key`: a key belonging to no certificate here.
 *
 * FAILS RATHER THAN SKIPS WHERE CI RUNS. `openssl` is on every GitHub runner and
 * on macOS; the one place it is plausibly missing is a bare Windows checkout, and
 * there this skips with its reason printed. In CI a missing openssl is a failure,
 * because a silent skip of the whole TLS half is exactly the green gate over
 * nothing this project keeps finding.
 */
const TLS_DIR = mkdtempSync(join(tmpdir(), "decksmith-tls-"));
const TLS_MADE: string | true = (() => {
  const run = (...args: string[]) => execFileSync("openssl", args, { cwd: TLS_DIR, stdio: "pipe" });
  try {
    const self = (name: string, subject: string, ...ext: string[]) =>
      run(
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-keyout",
        `${name}.key`,
        "-out",
        `${name}.crt`,
        "-days",
        "36500",
        "-subj",
        subject,
        ...ext,
      );
    self(
      "server",
      "/CN=cn-only.test",
      "-addext",
      "subjectAltName=DNS:deck.test,DNS:*.wild.test,IP:127.0.0.1,IP:::1",
    );
    self("cn-only", "/CN=cn-only.test");
    run("genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", "other.key");
    // A DER copy of the good certificate: valid X.509 that is not a PEM chain,
    // which is one of the two pairs `readTls` has to refuse rather than let
    // OpenSSL throw at `listen`.
    run("x509", "-in", "server.crt", "-outform", "der", "-out", "server.der");
    // The other one: a pair nothing here can fault and OpenSSL will not load.
    // A small RSA key is a perfectly good `KeyObject` that `checkPrivateKey`
    // agrees with, and `ee key too small` to OpenSSL. The key comes from Node
    // rather than openssl because `genpkey` on a small modulus is the part most
    // likely to differ between the OpenSSL this runs on and the LibreSSL macOS
    // ships; signing an existing key does not.
    //
    // 512 BITS, NOT 1024, AND CI IS WHY. A security level is a floor in BITS OF
    // SECURITY, and level 1 — the default — puts that floor at 80, which RSA-1024
    // meets. It was refused on the OpenSSL 3.5.5 that Node 24 bundles here and
    // accepted by the one CI's Node 22 has, so this case went green locally and
    // red on the runner. 512 is below every level OpenSSL defines, and
    // `WEAK_REJECTION` below reads the code off OpenSSL rather than assuming it.
    writeFileSync(
      join(TLS_DIR, "weak.key"),
      generateKeyPairSync("rsa", {
        modulusLength: 512,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey,
    );
    run(
      "req",
      "-x509",
      "-new",
      "-key",
      "weak.key",
      "-out",
      "weak.crt",
      "-days",
      "36500",
      "-subj",
      "/CN=weak.test",
      "-addext",
      "subjectAltName=DNS:deck.test",
    );
    return true;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
})();
if (TLS_MADE !== true && process.env.CI) {
  throw new Error(
    `openssl is required to run these tests and did not work: ${TLS_MADE}. ` +
      "The TLS material is generated rather than committed; see test/server.test.ts.",
  );
}
/** True when the generated material is there. Gates the suites that need it. */
const TLS_OK = TLS_MADE === true;
/** A test that cannot run without `openssl`. In CI the throw above fires first. */
const itTls = it.skipIf(!TLS_OK);

/**
 * The code THIS OpenSSL refuses the weak pair with, read from OpenSSL itself.
 *
 * Asserting a fixed code would be asserting a build detail: the refusal depends
 * on the security level, and the level's floor is in bits of security rather
 * than in a key size anyone writes down. What the test is actually for is the
 * implication — whatever `createSecureContext` refuses, `resolveSecurity`
 * refuses too, in OpenSSL's own words, before main.ts touches the disk — so the
 * word to compare against comes from the same call the server will make.
 *
 * A LOUD THROW, never a skip, if this OpenSSL loads a 512-bit key: then there is
 * no weak pair to refuse and the case would silently stop testing anything.
 */
const WEAK_REJECTION: string = (() => {
  if (!TLS_OK) return "";
  try {
    createSecureContext({
      cert: readFileSync(join(TLS_DIR, "weak.crt")),
      key: readFileSync(join(TLS_DIR, "weak.key")),
      minVersion: TLS_MIN_VERSION,
    });
  } catch (err) {
    return (err as { code?: string }).code ?? "";
  }
  throw new Error(
    "this OpenSSL loaded a 512-bit RSA key, so there is no pair here for `readTls` to be measured against. " +
      `Node ${process.version}, OpenSSL ${process.versions.openssl}.`,
  );
})();
afterAll(() => {
  rmSync(TLS_DIR, { recursive: true, force: true });
});

const tlsFixture = (name: string) => join(TLS_DIR, name);
/**
 * Read a generated file, or the empty buffer when openssl did not run — the
 * suites that use these are skipped in that case, and a module-scope throw would
 * take the other nine hundred assertions in this file down with it.
 */
const tlsBytes = (name: string) => (TLS_OK ? readFileSync(tlsFixture(name)) : Buffer.alloc(0));
const TLS_CERT = tlsBytes("server.crt");
const TLS: TlsMaterial = {
  cert: TLS_CERT,
  key: tlsBytes("server.key"),
  // Parsed lazily-ish: an empty buffer is not a certificate, and the suites that
  // touch `TLS.x509` are the ones `TLS_OK` gates.
  x509: TLS_OK ? new X509Certificate(TLS_CERT) : (undefined as unknown as X509Certificate),
};

/** The deck CSP as it was before tokens existed, pinned whole. */
const DECK_CSP = `sandbox allow-scripts allow-same-origin allow-downloads; connect-src 'none'; frame-src 'self' ${EMBED_ORIGINS.join(" ")}`;

/** The repository root, from this file. */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * `dist/server/`, rebuilt from the current source ONCE per run and shared.
 *
 * Two suites need the built server for different reasons — "the built server",
 * where running the real artifact is the whole point, and B7, which needs the
 * real /examples/embed.html that only dist/ has — and the second must not
 * silently depend on the first having run first. `npm run build` does not build
 * this directory; `build:server` does, and it is seconds.
 */
let serverBuild: Promise<{ createDeckServer: typeof createDeckServer }> | undefined;
function builtServer(): Promise<{ createDeckServer: typeof createDeckServer }> {
  serverBuild ??= (async () => {
    // FAILS, never skips. CI's `npm ci` builds dist/ through `prepare`, so this
    // only fires on a checkout nobody built — which is the one place a skip
    // would be read as a pass.
    if (!existsSync(join(ROOT, "dist", "index.js"))) {
      throw new Error(
        "dist/index.js is missing. Run `npm run build` first: `npm run check` does not build, and these tests start the built server.",
      );
    }
    await execFileP("npm", ["run", "build:server"], { cwd: ROOT });
    return (await import(pathToFileURL(join(ROOT, "dist", "server", "http.js")).href)) as {
      createDeckServer: typeof createDeckServer;
    };
  })();
  return serverBuild;
}

const servers: (() => Promise<void>)[] = [];
async function closeServers(): Promise<void> {
  for (const close of servers.splice(0)) await close();
}

/**
 * A server with the pipeline stubbed. It always LISTENS on 127.0.0.1; `host` is
 * what the server believes it is bound to, so an exposed bind can be tested
 * without one. `runs` counts calls into the pipeline, `logs` collects the log.
 */
async function serve(over: Partial<ServeOptions> = {}, make = createDeckServer) {
  const work = await scratch();
  const logs: string[] = [];
  const counter = { runs: 0 };
  const stub: NonNullable<ServeOptions["run"]> = async (job) => {
    // Writes the deck a real pipeline would write, without being one.
    await mkdir(join(job.dir, "deck", "assets"), { recursive: true });
    await writeFile(join(job.dir, "deck", "deck.html"), "<h1>deck</h1>");
    await writeFile(join(job.dir, "deck", "assets", "fig1.png"), "PNGDATA");
    job.begin("ingest");
    job.done("ingest");
    return { deckUrl: `/d/${job.id}/deck.html`, slides: 4, duration: 12, warnings: [] };
  };
  const run = over.run ?? stub;
  const { server, queue } = make({
    port: 0,
    host: "127.0.0.1",
    work,
    maxUploadBytes: 1 << 20,
    maxQueued: 4,
    ttlMs: 60_000,
    jobsPerHour: 100,
    requestsPerMinute: 1000,
    fetchRemoteFigures: false,
    sandboxDecks: true,
    removeDir: () => {},
    log: (line) => logs.push(line),
    ...over,
    run: (job, input) => {
      counter.runs++;
      return run(job, input);
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const base = `${over.tls ? "https" : "http"}://127.0.0.1:${port}`;
  // The cookie's name and the MAC's binding both carry this listener's port, so
  // neither can be a literal in a test: every server here binds port 0.
  const cookie = cookieName(over.tls !== undefined, port);
  const bind = sessionBinding(over.host ?? "127.0.0.1", port);
  servers.push(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  return {
    base,
    port,
    queue,
    work,
    logs,
    server,
    /** This listener's cookie name: `decksmith-<port>`, `__Host-`-prefixed over TLS. */
    cookie,
    /** What this listener MACs its sessions over. */
    bind,
    /** A `Cookie:` header this listener accepts, as a browser would send it. */
    session: (at = Date.now(), keys = KEYS) => `${cookie}=${mintSession(keys, at, bind)}`,
    get runs() {
      return counter.runs;
    },
  };
}

interface Posted {
  status: number;
  id: string;
  error?: { message: string; hint: string };
}

async function post(
  base: string,
  parts: Parameters<typeof multipart>[0],
  headers: Record<string, string> = {},
): Promise<Posted> {
  const { body, contentType } = multipart(parts);
  const res = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { ...headers, "content-type": contentType },
    // `BodyInit` does not name Node's Buffer; the view is over the same bytes.
    body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength),
  });
  const json = (await res.json()) as { id?: string; error?: Posted["error"] };
  return { status: res.status, id: json.id ?? "", ...(json.error ? { error: json.error } : {}) };
}

async function settle(base: string, id: string, headers: Record<string, string> = {}) {
  for (let i = 0; i < 200; i++) {
    const view = (await (await fetch(`${base}/api/jobs/${id}`, { headers })).json()) as {
      state: string;
    };
    if (view.state === "done" || view.state === "error") return view;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never settled");
}

interface Raw {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  error?: { message: string; hint: string };
}

/**
 * A request carrying the headers a BROWSER attaches. `fetch` in Node sends
 * none of them, and will not let a caller set `host` at all, so every test
 * above is a non-browser client whether it meant to be or not.
 *
 * Over https it trusts the fixture certificate and verifies it as `deck.test`,
 * whatever `Host` says, so a Host test is about Host and not about TLS.
 *
 * `early` writes the headers and the first 64 KB of the body and then WAITS: a
 * server that answers before reading the body is proved to have answered
 * before reading it, and the client is not left writing into a socket the
 * server has already closed.
 */
function raw(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Buffer,
  early = false,
): Promise<Raw> {
  return new Promise((done, failed) => {
    let answered = false;
    let rest: NodeJS.Timeout | undefined;
    const secure = base.startsWith("https:");
    const options = {
      method,
      headers,
      agent: false as const,
      ...(secure ? { ca: TLS_CERT, servername: "deck.test" } : {}),
    };
    const req = (secure ? httpsRequest : request)(`${base}${path}`, options, (res) => {
      answered = true;
      if (rest) clearTimeout(rest);
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let error: Raw["error"];
        try {
          error = (JSON.parse(text) as { error?: Raw["error"] }).error;
        } catch {
          // Not JSON: a page, or nothing.
        }
        done({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text,
          ...(error ? { error } : {}),
        });
        if (early) req.destroy();
      });
    });
    req.on("error", (err) => {
      if (!answered) failed(err);
    });
    if (early && body) {
      req.flushHeaders();
      req.write(body.subarray(0, 64 * 1024));
      rest = setTimeout(() => req.end(body.subarray(64 * 1024)), 3000);
    } else {
      req.end(body);
    }
  });
}

/**
 * Bytes on a socket, for the requests no client library will send: a Host
 * header that is empty or absent, or a request line `new URL` cannot parse.
 */
function rawSocket(
  base: string,
  text: string,
): Promise<{ status: number; headers: Record<string, string> }> {
  const { hostname, port } = new URL(base);
  return new Promise((done, failed) => {
    const socket = base.startsWith("https:")
      ? tlsConnect({ host: hostname, port: Number(port), ca: TLS_CERT, servername: "deck.test" })
      : netConnect(Number(port), hostname);
    let got = "";
    socket.once(base.startsWith("https:") ? "secureConnect" : "connect", () => socket.write(text));
    socket.on("data", (c: Buffer) => {
      got += c.toString("latin1");
    });
    socket.on("end", () => {
      const [status = "", ...lines] = (got.split("\r\n\r\n")[0] ?? "").split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of lines) {
        const at = line.indexOf(":");
        if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
      }
      done({ status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(status)?.[1] ?? 0), headers });
    });
    socket.on("error", failed);
  });
}

const upload = () => multipart([{ name: "file", value: "# P\n", filename: "p.md" }]);

/** The header shapes a write from another site arrives with. */
const CROSS_SITE: [string, Record<string, string>][] = [
  ["a page on another site", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }],
  [
    "another port on the same site",
    { "sec-fetch-site": "same-site", origin: "http://127.0.0.1:1" },
  ],
  ["a browser that predates fetch metadata", { origin: "https://evil.example" }],
  ["a sandboxed frame", { origin: "null" }],
];

/** A finished deck on disk, as `serveDeck` reads it; the queue never hears of it. */
async function deckOnDisk(work: string, html = "<h1>deck</h1>"): Promise<string> {
  const id = randomBytes(16).toString("base64url");
  await mkdir(join(work, id, "deck", "assets"), { recursive: true });
  await writeFile(join(work, id, "deck", "deck.html"), html);
  await writeFile(join(work, id, "deck", "assets", "fig1.png"), "PNGDATA");
  return id;
}

/**
 * A session cookie header for `KEYS`, as a browser would send it.
 *
 * Every argument comes from the server it is for: the name carries its port and
 * the MAC carries its bind, so a cookie minted for one listener is refused by
 * another. `serve()` returns `session()`, which is this with both filled in.
 */
const sessionFor = (bind: string, name: string, at = Date.now()) =>
  `${name}=${mintSession(KEYS, at, bind)}`;

/** The name=value of a Set-Cookie line, and its attributes lowercased. */
function parseSetCookie(line: string): { name: string; value: string; attrs: string[] } {
  const [pair = "", ...attrs] = line.split(";").map((s) => s.trim());
  const at = pair.indexOf("=");
  return {
    name: pair.slice(0, at),
    value: pair.slice(at + 1),
    attrs: attrs.map((a) => a.toLowerCase()),
  };
}

/* ------------------------------------------------------------------- the routes */

describe("the HTTP surface", () => {
  afterEach(closeServers);

  /**
   * BOTH STATIC ROUTES, AND WHY THE ASSERTION IS 500 RATHER THAN 200.
   *
   * `/player.js` and `/examples/embed.html` resolve their file relative to
   * `import.meta.url`, so a shipped `dist/server/http.js` reaches
   * `dist/deck-player-element.js` and `dist/embed.html` as siblings-of-a-parent.
   * Run from source, that same expression points into `src/`, where neither
   * exists — the same source-tree gap the `illustrate` suite below records for
   * `dist/deck-runtime.js`. So what a source test can prove is that the ROUTE
   * is there and that its failure is legible: never a 404, and an error that
   * names the command which produces the file. That the file is produced at all
   * is gated in scripts/build.mjs, whose `promised` map now includes both.
   */
  it.each([
    ["/player.js", "dist/deck-player-element.js"],
    ["/examples/embed.html", "dist/embed.html"],
  ])("routes %s and, missing its artifact, says which build makes it", async (path, artifact) => {
    const { base } = await serve();
    const res = await fetch(`${base}${path}`);
    expect(res.status, `${path} must be routed, not fall through to the 404 arm`).not.toBe(404);
    if (res.status === 200) return; // A dist-tree run: the artifact is there.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { message: string; hint: string } };
    expect(body.error.hint).toContain("npm run build");
    expect(body.error.hint).toContain(artifact);
  });

  it("publishes the format catalogue the picker needs", async () => {
    const { base } = await serve();
    const body = (await (await fetch(`${base}/api/formats`)).json()) as {
      formats: { id: string; width: number; maxSeconds: number | null }[];
      themes: string[];
    };
    expect(body.formats.map((f) => f.id)).toContain("short-9x16");
    expect(body.formats.find((f) => f.id === "deck-16x9")?.maxSeconds).toBeNull();
    expect(body.themes).toContain("ink");
  });

  it("takes an upload, answers 202 with an id, and finishes the job", async () => {
    const { base } = await serve();
    const { status, id } = await post(base, [
      { name: "file", value: "# Paper\n\nProse.\n", filename: "paper.md" },
    ]);
    expect(status).toBe(202);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const view = (await settle(base, id)) as {
      state: string;
      result: { deckUrl: string; slides: number };
      steps: { name: string; state: string }[];
    };
    expect(view.state).toBe("done");
    expect(view.result.slides).toBe(4);
    expect(view.steps[0]).toMatchObject({ name: "ingest", state: "done" });

    const deck = await fetch(`${base}${view.result.deckUrl}`);
    expect(deck.status).toBe(200);
    expect(await deck.text()).toBe("<h1>deck</h1>");
    // A stranger's document compiled to HTML is sandboxed.
    const csp = deck.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/sandbox allow-scripts/);
    /**
     * `allow-same-origin` IS LOAD-BEARING — do not "tighten" this by removing it.
     *
     * deck.html is the HyperFrames player and it drives the composition through
     * `iframe.contentDocument`. A CSP sandbox without this token puts index.html
     * on a unique opaque origin, `contentDocument` is null, and EVERY SLIDE
     * RENDERS BLANK while the job reports `done`, every file 200s, and the
     * console stays empty. Measured both ways on identical bytes:
     * experiments/011-reconcile/06-served-deck-slide2.png (blank) against
     * 08-sandbox-fixed-slide2.png (correct).
     */
    expect(csp).toContain("allow-same-origin");
    // And the tokens that are still withheld are the ones worth withholding.
    for (const token of ["allow-forms", "allow-popups", "allow-modals", "allow-top-navigation"]) {
      expect(csp).not.toContain(token);
    }
    /**
     * `frame-src 'self'`, AND IT MUST NOT BE `'none'` — the same trap as
     * `allow-same-origin` above, one directive along.
     *
     * A deck may not frame a third party, which is what `'none'` sounds like it
     * says. But deck.html IS a framing document: the HyperFrames player builds
     * `<iframe src="index.html">` at runtime and drives it through
     * `contentDocument`. `'none'` blocks that child and every slide renders
     * blank while the job reports `done` — the failure already measured for the
     * sandbox list, reachable a second way. Nothing else in this suite would
     * catch it, because the stub deck this test serves has no iframe in it.
     */
    expect(csp).toContain("frame-src 'self'");
    expect(csp).not.toContain("frame-src 'none'");
    /**
     * AND THE PLAYER ORIGINS, WHICH IS THE WHOLE OF WHAT `frame-src` MAY NAME.
     *
     * A presented deck opens a player-page video in a frame on the viewer's
     * click (src/deck/runtime.ts), so its origin has to be allowed. The list is
     * `EMBED_ORIGINS`, derived from the per-host embed rules — asserted as an
     * exact set rather than by `toContain`, because the failure worth catching
     * here is the widening nobody meant: a `*`, a bare `https:`, or an origin
     * left over from a rule that no longer exists. Any of those hands every
     * uploaded document the right to frame whatever it likes.
     */
    const frameSrc = /frame-src ([^;]*)/.exec(csp)?.[1]?.trim().split(" ");
    expect(frameSrc).toEqual(["'self'", ...EMBED_ORIGINS]);
    expect(deck.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses a request carrying both a file and a url, without queueing anything", async () => {
    const { base, queue } = await serve();
    const res = await post(base, [
      { name: "file", value: "# P\n", filename: "p.md" },
      { name: "url", value: "https://example.com/paper" },
    ]);
    expect(res.status).toBe(400);
    expect(res.error?.message).toMatch(/both a "file" part and a "url" field/);
    expect(res.error?.hint).toMatch(/one or the other/);
    expect(queue.depth).toBe(0);
  });

  /**
   * CSRF. A multipart POST is a CORS-simple request: any page on any site can
   * make its visitor's browser send one, with no preflight, and the job runs on
   * this machine's Codex quota. CORS stops that page READING the answer, not
   * the request being made. What stops it is the browser saying where the
   * request came from — `Sec-Fetch-Site`, or `Origin` where that is missing.
   */
  it.each(CROSS_SITE)(
    "refuses a job submitted by %s, without queueing anything",
    async (_, headers) => {
      const { base, queue } = await serve();
      const { body, contentType } = upload();
      const res = await raw(
        base,
        "POST",
        "/api/jobs",
        { ...headers, "content-type": contentType },
        body,
      );
      expect(res.status).toBe(403);
      expect(res.error?.message).toMatch(/another site/);
      expect(queue.depth).toBe(0);
    },
  );

  it("refuses a retry another site asks for", async () => {
    const { base } = await serve();
    const res = await raw(base, "POST", `/api/jobs/${"A".repeat(22)}/retry`, {
      "sec-fetch-site": "cross-site",
    });
    // 403 rather than the route's own 404: the refusal comes before routing.
    expect(res.status).toBe(403);
  });

  it("still takes a job from its own page, and from a client that is not a browser", async () => {
    const { base } = await serve();
    const { body, contentType } = upload();
    const headers: Record<string, string>[] = [
      { "sec-fetch-site": "same-origin", origin: base },
      { origin: base },
      {},
    ];
    for (const h of headers) {
      const res = await raw(base, "POST", "/api/jobs", { ...h, "content-type": contentType }, body);
      expect(res.status, JSON.stringify(h)).toBe(202);
    }
  });

  /**
   * DNS REBINDING, which walks straight past the check above. A page at
   * evil.example re-resolves its own name to 127.0.0.1, and from then on its
   * requests here are same-origin by every header they carry — and, unlike a
   * CSRF, it can read the answers. The one thing it cannot forge is the name it
   * used: `Host` still says evil.example.
   */
  it("answers only to a loopback name while bound to loopback", async () => {
    const { base } = await serve();
    const port = new URL(base).port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      expect((await raw(base, "GET", "/api/formats", { host })).status, host).toBe(200);
    }
    const rebound = `evil.example:${port}`;
    const read = await raw(base, "GET", "/api/formats", { host: rebound });
    expect(read.status).toBe(403);
    expect(read.error?.message).toContain(rebound);

    const { body, contentType } = upload();
    const res = await raw(
      base,
      "POST",
      "/api/jobs",
      {
        host: rebound,
        origin: `http://${rebound}`,
        "sec-fetch-site": "same-origin",
        "content-type": contentType,
      },
      body,
    );
    expect(res.status).toBe(403);
  });

  /**
   * The URL path through the ROUTES, with the pipeline stubbed: what is asserted
   * here is the wiring — that a url is accepted, reaches `runPipeline` as a url
   * and not as an upload, and survives a restart the same way a file does. What
   * a harvest actually produces is the suite further down, which needs a browser.
   */
  it("takes a url, hands the pipeline a url, and resumes one after a restart", async () => {
    const seen: { upload?: unknown; url?: string }[] = [];
    const { base, work } = await serve({
      run: async (job, input) => {
        seen.push({
          ...(input.upload ? { upload: input.upload } : {}),
          ...(input.url ? { url: input.url } : {}),
        });
        const { mkdir, writeFile: write } = await import("node:fs/promises");
        await mkdir(join(job.dir, "deck"), { recursive: true });
        await write(join(job.dir, "deck", "deck.html"), "<h1>deck</h1>");
        return { deckUrl: `/d/${job.id}/deck.html`, slides: 4, duration: 12, warnings: [] };
      },
    });
    const { status, id } = await post(base, [
      { name: "url", value: "https://example.com/paper" },
      { name: "format", value: "short-9x16" },
    ]);
    expect(status).toBe(202);
    await settle(base, id);
    expect(seen).toEqual([{ url: "https://example.com/paper" }]);

    // The retry copy is on disk, and it is the URL rather than a file: nothing
    // named upload.bin, because there are no bytes to keep.
    expect((await readdir(join(work, id))).sort()).toEqual(["deck", "job.json"]);

    // And /retry starts it again under a new id — the path that was upload-only
    // before, and that a URL job would otherwise have fallen out of.
    const retry = await fetch(`${base}/api/jobs/${id}/retry`, { method: "POST" });
    expect(retry.status).toBe(202);
    const second = (await retry.json()) as { id: string };
    await settle(base, second.id);
    expect(seen[1]).toEqual({ url: "https://example.com/paper" });
  });

  it("serves a deck's assets and refuses a path that leaves it", async () => {
    const { base, work } = await serve();
    const { id } = await post(base, [{ name: "file", value: "# Paper\n", filename: "paper.md" }]);
    await settle(base, id);
    await writeFile(join(work, "secret.txt"), "not yours");

    expect(await (await fetch(`${base}/d/${id}/assets/fig1.png`)).text()).toBe("PNGDATA");
    // Percent-encoded, because WHATWG URL collapses a literal ../ before we see it.
    const escaped = await fetch(`${base}/d/${id}/%2e%2e%2f%2e%2e%2fsecret.txt`);
    expect(escaped.status).toBe(400);
    expect(await escaped.text()).not.toContain("not yours");
    // Another job's id is not this job's directory, and neither is a made-up one.
    expect((await fetch(`${base}/d/${"A".repeat(22)}/deck.html`)).status).toBe(404);
    expect((await fetch(`${base}/d/..%2f..%2fetc/passwd`)).status).toBe(404);
  });

  it("serves a byte range so a video can be scrubbed", async () => {
    const { base } = await serve();
    const { id } = await post(base, [{ name: "file", value: "# P\n", filename: "p.md" }]);
    await settle(base, id);
    const res = await fetch(`${base}/d/${id}/assets/fig1.png`, {
      headers: { range: "bytes=0-2" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-2/7");
    expect(await res.text()).toBe("PNG");
  });

  it("streams the same payload over SSE", async () => {
    const { base } = await serve();
    const { id } = await post(base, [{ name: "file", value: "# P\n", filename: "p.md" }]);
    const res = await fetch(`${base}/api/jobs/${id}/events`);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text(); // the server ends the stream when the job settles
    const frames = text
      .split("\n\n")
      .filter((f) => f.startsWith("data: "))
      .map((f) => JSON.parse(f.slice(6)) as { id: string; state: string });
    expect(frames.at(-1)?.state).toBe("done");
    expect(frames.at(-1)?.id).toBe(id);
  });

  it("refuses a bad upload before it costs anything", async () => {
    const { base, queue } = await serve();
    // Nothing is queued and no directory is made: the upload is judged before
    // it costs a job slot. (A wrong FILE TYPE is caught later, at ingest, where
    // the bytes are — see the ingest suite.)
    const bad = await post(base, [{ name: "notfile", value: "x" }]);
    expect(bad.status).toBe(400);
    // NEITHER half of the choice, and the message says so rather than naming
    // only the file — which is what sent someone submitting a URL looking for a
    // bug in their form encoding. The hint names the other half too.
    expect(bad.error?.message).toMatch(/neither a "file" part nor a "url" field/);
    expect(bad.error?.hint).toMatch(/"url" field/);
    expect(queue.depth).toBe(0);
    expect(queue.running).toBeUndefined();
  });

  it("refuses an option it does not know, without queueing anything", async () => {
    const { base, queue } = await serve();
    const res = await post(base, [
      { name: "file", value: "# P\n", filename: "p.md" },
      { name: "format", value: "imax" },
    ]);
    expect(res.status).toBe(400);
    expect(res.error?.message).toMatch(/Unknown format/);
    expect(queue.depth).toBe(0);
  });

  it("caps how many decks one address may ask for", async () => {
    const { base } = await serve({ jobsPerHour: 1 });
    expect((await post(base, [{ name: "file", value: "# P\n", filename: "p.md" }])).status).toBe(
      202,
    );
    const second = await post(base, [{ name: "file", value: "# P\n", filename: "p.md" }]);
    expect(second.status).toBe(429);
    expect(second.error?.hint).toMatch(/minutes of CPU/);
  });

  it("refuses an upload over the cap with a 413 the client can actually read", async () => {
    // The regression this pins: destroying the socket the moment the limit is
    // crossed means the client is still writing and never reads the reply, so
    // `fetch` reports a socket error rather than a 413 with a sentence in it.
    const { base } = await serve({ maxUploadBytes: 512 });
    const res = await post(base, [{ name: "file", value: "#".repeat(2000), filename: "big.md" }]);
    expect(res.status).toBe(413);
    expect(res.error?.message).toMatch(/larger than/);
  });

  it("says what it does not route", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).toMatch(/POST \/api\/jobs/);
    expect((await fetch(`${base}/api/jobs/not-an-id`)).status).toBe(404);
  });

  it("serves an uploader page", async () => {
    const { base } = await serve();
    const res = await fetch(base);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/<form/);
  });
});

/* ------------------------------------------------------------ the startup policy */

/**
 * `resolveSecurity`, the whole of what `npm run serve` will and will not start
 * with. Real files in a scratch directory, because the modes are part of what is
 * judged; an injected clock, because the certificates are valid for a century.
 */
describe("the startup policy", () => {
  let dir = "";
  let n = 0;
  beforeAll(async () => {
    dir = await scratch();
  });

  async function put(content: string | Buffer, mode = 0o600, ext = ""): Promise<string> {
    const path = join(dir, `f${n++}${ext}`);
    await writeFile(path, content);
    await chmod(path, mode);
    return path;
  }
  const deps = (now = Date.now()): SecurityDeps => ({
    readFile: (path) => readFileSync(path),
    stat: (path) => statSync(path),
    now: () => now,
    platform: process.platform,
  });
  const tokenFile = (content = `${TOKEN}\n`, mode = 0o600) => put(content, mode);
  /** The fixture pair; the key copied to 0600, because git does not keep modes. */
  async function pair(key = tlsBytes("server.key"), cert = TLS_CERT) {
    return {
      DECKSMITH_TLS_CERT: await put(cert, 0o644, ".crt"),
      DECKSMITH_TLS_KEY: await put(key, 0o600, ".key"),
    };
  }
  function refusal(env: NodeJS.ProcessEnv, d = deps()): SecurityRefusal {
    try {
      resolveSecurity(env, d);
    } catch (err) {
      if (err instanceof SecurityRefusal) return err;
      throw err;
    }
    throw new Error(`expected a refusal for ${Object.keys(env).join(", ")}`);
  }
  const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it("R1: loopback with nothing set is exactly what it was", () => {
    expect(resolveSecurity({}, deps())).toEqual({
      host: "127.0.0.1",
      loopback: true,
      sandboxDecks: true,
      warnings: [],
    });
    for (const host of ["::1", "localhost"]) {
      expect(resolveSecurity({ DECKSMITH_HOST: host }, deps()).loopback).toBe(true);
    }
  });

  it.each(["0.0.0.0", "::", "127.0.0.2", "192.168.1.10", "::ffff:127.0.0.1", ""])(
    "R2: DECKSMITH_HOST=%j with nothing else is refused, naming all three and the tunnel",
    (host) => {
      const err = refusal({ DECKSMITH_HOST: host });
      expect(err.problems).toHaveLength(1);
      for (const said of [
        "DECKSMITH_TOKEN_FILE",
        "DECKSMITH_TLS_CERT",
        "DECKSMITH_TLS_KEY",
        "openssl rand",
        "ssh -L",
      ]) {
        expect(err.message).toContain(said);
      }
    },
  );

  itTls("R3: an exposed bind with half of what it needs names exactly the other half", async () => {
    const tokenOnly = refusal({
      DECKSMITH_HOST: "0.0.0.0",
      DECKSMITH_TOKEN_FILE: await tokenFile(),
    });
    expect(tokenOnly.problems).toHaveLength(1);
    expect(tokenOnly.message).toContain("DECKSMITH_TLS_CERT");
    expect(tokenOnly.message).toContain("DECKSMITH_TLS_KEY");
    expect(tokenOnly.message).not.toContain("DECKSMITH_TOKEN_FILE");

    const tlsOnly = refusal({ DECKSMITH_HOST: "0.0.0.0", ...(await pair()) });
    expect(tlsOnly.problems).toHaveLength(1);
    expect(tlsOnly.message).toContain("DECKSMITH_TOKEN_FILE");
    expect(tlsOnly.message).not.toMatch(/DECKSMITH_TLS_(CERT|KEY)/);
  });

  itTls(
    "R4: half a TLS pair is refused on loopback too, naming the half that is unset",
    async () => {
      const { DECKSMITH_TLS_CERT, DECKSMITH_TLS_KEY } = await pair();
      expect(refusal({ DECKSMITH_TLS_CERT }).message).toMatch(/^DECKSMITH_TLS_KEY is unset/);
      expect(refusal({ DECKSMITH_TLS_KEY }).message).toMatch(/^DECKSMITH_TLS_CERT is unset/);
    },
  );

  itTls(
    "R5: DECKSMITH_TOKEN is refused on any bind, even empty, and points at the file",
    async () => {
      const exposed = {
        DECKSMITH_HOST: "0.0.0.0",
        DECKSMITH_TOKEN_FILE: await tokenFile(),
        ...(await pair()),
      };
      for (const env of [
        { DECKSMITH_TOKEN: TOKEN },
        { DECKSMITH_TOKEN: "" },
        { ...exposed, DECKSMITH_TOKEN: TOKEN },
      ]) {
        const err = refusal(env);
        expect(err.problems).toHaveLength(1);
        expect(err.message).toMatch(/^DECKSMITH_TOKEN is set/);
        expect(err.message).toContain("DECKSMITH_TOKEN_FILE");
      }
    },
  );

  it("R6: a token file is refused for each thing wrong with it, and a good one is read", async () => {
    const missing = join(dir, "no-such-token");
    const cases: [string, RegExp][] = [
      [missing, new RegExp(`cannot read DECKSMITH_TOKEN_FILE \\(${literal(missing)}\\): ENOENT`)],
      [await tokenFile(`${TOKEN}\n`, 0o644), /readable by other users; chmod 600 it/],
      [await tokenFile("a".repeat(31)), /holds 31 characters; a token needs at least 32/],
      [await tokenFile(`${"a".repeat(20)} ${"b".repeat(20)}`), /contains whitespace/],
      [await tokenFile(""), /is empty/],
      [await tokenFile("\n"), /is empty/],
      [await tokenFile("a".repeat(1025)), /at most 1024/],
      [dir, /is not a regular file/],
    ];
    for (const [file, message] of cases) {
      const err = refusal({ DECKSMITH_TOKEN_FILE: file });
      expect(err.problems, file).toHaveLength(1);
      expect(err.message).toMatch(message);
    }
    // 44 characters and the newline `openssl rand -base64 32 >` writes.
    for (const content of [`${TOKEN}\n`, `${TOKEN}\r\n`, TOKEN]) {
      const security = resolveSecurity({ DECKSMITH_TOKEN_FILE: await tokenFile(content) }, deps());
      expect(security.auth?.tokenHash.equals(KEYS.tokenHash)).toBe(true);
    }
  });

  itTls(
    "R7: the deck sandbox cannot be turned off once there is a token or a network",
    async () => {
      const token = await tokenFile();
      for (const env of [
        { DECKSMITH_DECK_SANDBOX: "0", DECKSMITH_TOKEN_FILE: token },
        {
          DECKSMITH_DECK_SANDBOX: "off",
          DECKSMITH_HOST: "0.0.0.0",
          DECKSMITH_TOKEN_FILE: token,
          ...(await pair()),
        },
      ]) {
        const err = refusal(env);
        expect(err.problems).toHaveLength(1);
        expect(err.message).toMatch(/^DECKSMITH_DECK_SANDBOX is off/);
      }
      // On bare loopback it is still the operator's call, as it was.
      expect(resolveSecurity({ DECKSMITH_DECK_SANDBOX: "0" }, deps()).sandboxDecks).toBe(false);
    },
  );

  const validFrom = TLS_OK ? Date.parse(TLS.x509.validFrom) : 0;
  const validTo = TLS_OK ? Date.parse(TLS.x509.validTo) : 0;
  const encryptedKey = (type: "pkcs8" | "pkcs1") =>
    Buffer.from(
      type === "pkcs8"
        ? generateKeyPairSync("ec", {
            namedCurve: "P-256",
            privateKeyEncoding: { type, format: "pem", cipher: "aes-256-cbc", passphrase: "p" },
            publicKeyEncoding: { type: "spki", format: "pem" },
          }).privateKey
        : generateKeyPairSync("rsa", {
            modulusLength: 1024,
            privateKeyEncoding: { type, format: "pem", cipher: "aes-256-cbc", passphrase: "p" },
            publicKeyEncoding: { type: "spki", format: "pem" },
          }).privateKey,
    );

  /** [what, env, clock, the sentence, the variable whose path it must name] */
  const TLS_REFUSALS: [
    string,
    () => Promise<NodeJS.ProcessEnv>,
    number | undefined,
    RegExp,
    "DECKSMITH_TLS_CERT" | "DECKSMITH_TLS_KEY",
  ][] = [
    [
      "an unreadable certificate path",
      async () => ({ ...(await pair()), DECKSMITH_TLS_CERT: join(dir, "nope.crt") }),
      undefined,
      /^cannot read DECKSMITH_TLS_CERT \(.*nope\.crt\): ENOENT$/,
      "DECKSMITH_TLS_CERT",
    ],
    [
      // PEM on the outside, rubbish inside: the one path where `X509Certificate`
      // is what refuses, now that the header is checked before it.
      "a certificate that is not PEM",
      async () => ({
        ...(await pair()),
        DECKSMITH_TLS_CERT: await put(
          "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
        ),
      }),
      undefined,
      /^DECKSMITH_TLS_CERT \(.*\) is not a PEM certificate\.$/,
      "DECKSMITH_TLS_CERT",
    ],
    [
      // REVIEWER 3, MEASURED. `new X509Certificate(der)` parses this happily and
      // `checkPrivateKey` agrees with it, so before the header check it passed
      // every gate here and threw ERR_OSSL_PEM_NO_START_LINE out of
      // `createServer` — after main.ts had made the work directory.
      "a DER certificate, which every check here used to accept",
      async () => ({ ...(await pair()), DECKSMITH_TLS_CERT: await put(tlsBytes("server.der")) }),
      undefined,
      /^DECKSMITH_TLS_CERT \(.*\) is not a PEM chain: .*openssl x509 -inform der/s,
      "DECKSMITH_TLS_CERT",
    ],
    [
      // REVIEWER 3, THE OTHER HALF. Nothing Node parses can fault this pair; the
      // certificate matches the key, the SANs are there and it is in date. What
      // refuses it is OpenSSL, at the same `minVersion` the server will use.
      "a key OpenSSL will not load, which nothing Node parses can fault",
      () => pair(tlsBytes("weak.key"), tlsBytes("weak.crt")),
      undefined,
      new RegExp(
        `^OpenSSL will not load DECKSMITH_TLS_CERT \\(.*\\) with DECKSMITH_TLS_KEY \\(.*\\): ${WEAK_REJECTION}\\b`,
      ),
      "DECKSMITH_TLS_CERT",
    ],
    [
      "the certificate passed as the key",
      () => pair(TLS_CERT),
      undefined,
      /^DECKSMITH_TLS_KEY \(.*\) is not a PEM private key\.$/,
      "DECKSMITH_TLS_KEY",
    ],
    [
      "an encrypted PKCS#8 key",
      () => pair(encryptedKey("pkcs8")),
      undefined,
      /^DECKSMITH_TLS_KEY \(.*\) is encrypted.*openssl pkey/,
      "DECKSMITH_TLS_KEY",
    ],
    [
      "a key from another pair",
      () => pair(tlsBytes("other.key")),
      undefined,
      /^DECKSMITH_TLS_KEY \(.*\) does not belong to the certificate in DECKSMITH_TLS_CERT/,
      "DECKSMITH_TLS_KEY",
    ],
    [
      "a certificate with only a common name",
      () => pair(tlsBytes("cn-only.key"), tlsBytes("cn-only.crt")),
      undefined,
      /^DECKSMITH_TLS_CERT \(.*\) has no subjectAltName, and browsers ignore the common name/,
      "DECKSMITH_TLS_CERT",
    ],
    [
      "an expired certificate",
      () => pair(),
      validTo + 1000,
      /^DECKSMITH_TLS_CERT \(.*\) has expired: .* check this machine's clock\.$/,
      "DECKSMITH_TLS_CERT",
    ],
    [
      "a certificate not yet valid",
      () => pair(),
      validFrom - 1000,
      /^DECKSMITH_TLS_CERT \(.*\) is not yet valid: .* check this machine's clock\.$/,
      "DECKSMITH_TLS_CERT",
    ],
    [
      "a key other users can read",
      async () => ({
        ...(await pair()),
        DECKSMITH_TLS_KEY: await put(tlsBytes("server.key"), 0o644),
      }),
      undefined,
      /^DECKSMITH_TLS_KEY \(.*\) is readable by other users; chmod 600 it\.$/,
      "DECKSMITH_TLS_KEY",
    ],
  ];

  itTls.each(TLS_REFUSALS)(
    "R8: refuses %s in a sentence of its own",
    async (_, env, now, sentence, variable) => {
      const e = await env();
      const err = refusal(e, deps(now));
      expect(err.problems).toHaveLength(1);
      expect(err.message).toMatch(sentence);
      expect(err.message).toContain(`${variable} (${e[variable]})`);
      expect(err.message).not.toContain("-----BEGIN");
      expect(err.message).not.toContain(TOKEN);
    },
  );

  itTls("R8: no two of those refusals say the same thing", async () => {
    const said = new Set<string>();
    for (const [, env, now] of TLS_REFUSALS) {
      said.add(refusal(await env(), deps(now)).message.replace(/\([^)]*\)/g, "(path)"));
    }
    expect(said.size).toBe(TLS_REFUSALS.length);
    // An old-style encrypted key is the same failure and gets the same sentence.
    expect(refusal(await pair(encryptedKey("pkcs1"))).message).toMatch(/is encrypted/);
  });

  itTls("R9: a certificate that expires within 14 days starts, with one warning", async () => {
    const security = resolveSecurity(await pair(), deps(validTo - 10 * 86_400_000));
    expect(security.tls?.x509.subjectAltName).toContain("DNS:deck.test");
    expect(security.warnings).toHaveLength(1);
    expect(security.warnings[0]).toMatch(/expires .*, in 10 day\(s\)/);
  });

  itTls("R10: no refusal, banner or warning carries the token", async () => {
    const said: string[] = [];
    const run = (env: NodeJS.ProcessEnv, d = deps()) => {
      try {
        const security: Security = resolveSecurity(env, d);
        said.push(...securityBanner(security, 8475), ...security.warnings);
      } catch (err) {
        if (!(err instanceof SecurityRefusal)) throw err;
        said.push(err.message);
      }
    };
    run({ DECKSMITH_TOKEN: TOKEN });
    run({ DECKSMITH_TOKEN_FILE: await tokenFile(`${TOKEN}\n`, 0o644) });
    run({ DECKSMITH_TOKEN_FILE: await tokenFile(`${TOKEN} ${TOKEN}`) });
    run({ DECKSMITH_TOKEN_FILE: await tokenFile(TOKEN.slice(0, 31)) });
    run({ DECKSMITH_TOKEN_FILE: await tokenFile(TOKEN.repeat(30)) });
    run({ DECKSMITH_HOST: "0.0.0.0", DECKSMITH_TOKEN_FILE: await tokenFile() });
    run({ DECKSMITH_DECK_SANDBOX: "0", DECKSMITH_TOKEN_FILE: await tokenFile() });
    run({ ...(await pair()), DECKSMITH_TLS_CERT: await put(TOKEN) });
    run(await pair(Buffer.from(TOKEN)));
    for (const [, env, now] of TLS_REFUSALS) run(await env(), deps(now));
    // And the two banners a server that starts prints.
    run({ DECKSMITH_TOKEN_FILE: await tokenFile() });
    run(
      { DECKSMITH_HOST: "0.0.0.0", DECKSMITH_TOKEN_FILE: await tokenFile(), ...(await pair()) },
      deps(validTo - 86_400_000),
    );
    expect(said.join("\n")).toContain("auth: token from");
    // A NAME FROM THE CERTIFICATE, not the bind: see R12.
    expect(said.join("\n")).toContain("https://deck.test:8475");
    expect(said.join("\n")).not.toContain("https://0.0.0.0:8475");
    expect(said.join("\n")).toContain("expires");
    expect(said.filter((line) => line.includes("SENTINEL"))).toEqual([]);
  });

  itTls(
    "R11: createDeckServer itself refuses an exposed bind without both auth and tls",
    async () => {
      const options: ServeOptions = {
        port: 0,
        host: "0.0.0.0",
        work: await scratch(),
        maxUploadBytes: 1 << 20,
        maxQueued: 4,
        ttlMs: 60_000,
        jobsPerHour: 100,
        requestsPerMinute: 1000,
        fetchRemoteFigures: false,
        sandboxDecks: true,
        removeDir: () => {},
        log: () => {},
      };
      expect(() => createDeckServer(options)).toThrow(/needs both `auth` and `tls`/);
      expect(() => createDeckServer({ ...options, auth: KEYS })).toThrow(/needs both/);
      expect(() => createDeckServer({ ...options, tls: TLS })).toThrow(/needs both/);
      expect(() => createDeckServer({ ...options, auth: KEYS, tls: TLS })).not.toThrow();
      expect(() =>
        createDeckServer({ ...options, host: "127.0.0.1", auth: KEYS, sandboxDecks: false }),
      ).toThrow(/sandboxDecks: false/);
    },
  );

  /**
   * R12 — THE BANNER'S URL IS ONE THE SERVER ANSWERS TO.
   *
   * On an exposed bind the `Host` allowlist is the certificate's SANs and only
   * those, so the bind address is almost never one of them: the banner printed
   * `https://0.0.0.0:8475`, which this server refuses with 403 and the hint
   * "answers only to the names its certificate lists". Both halves are asserted
   * together — the name the banner prints, and that `foreignRequest` accepts it —
   * because the bug was exactly that those two disagreed.
   */
  itTls("R12: an exposed banner prints a certificate name, and says what it bound to", async () => {
    const env = {
      DECKSMITH_HOST: "0.0.0.0",
      DECKSMITH_TOKEN_FILE: await tokenFile(),
      ...(await pair()),
    };
    const lines = securityBanner(resolveSecurity(env, deps()), 8475);
    expect(lines[0]).toBe("https://deck.test:8475");
    expect(lines[1]).toContain("bound to 0.0.0.0");
    expect(lines[1]).toContain("DNS:deck.test");
    // The wildcard is not a host anyone can type, so it is never the one chosen.
    expect(lines[0]).not.toContain("*");

    // And loopback still prints the bind, which IS what it answers to.
    expect(securityBanner(resolveSecurity({}, deps()), 8475)[0]).toBe("http://127.0.0.1:8475");
    expect(securityBanner(resolveSecurity({ DECKSMITH_HOST: "::1" }, deps()), 8475)[0]).toBe(
      "http://[::1]:8475",
    );
  });
});

/* ------------------------------------------------------------- the built server */

/**
 * The file `npm run serve` runs, not the source. A refusal proved against
 * src/server/auth.ts says nothing about whether dist/server/main.js calls it
 * before it listens — or at all.
 */
describe("the built server", () => {
  const root = ROOT;
  afterEach(closeServers);

  beforeAll(async () => {
    await builtServer();
  }, 120_000);

  it("R12: refuses an exposed bind before it listens, and before it creates the work directory", async () => {
    const work = join(await scratch(), "w");
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("DECKSMITH_")) env[k] = v;
    // TEST-NET-1: no machine has this address, so a listen() would fail with
    // EADDRNOTAVAIL. Not seeing that is what proves the refusal came first.
    const child = spawn(process.execPath, [join(root, "dist", "server", "main.js")], {
      env: { ...env, DECKSMITH_HOST: "192.0.2.1", DECKSMITH_WORK: work },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const code = await new Promise<number | null>((resolve) => {
      // Only this child, by its own handle, and only if it outlives the budget.
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, 5000);
      child.on("close", (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    expect(code, stderr).toBe(1);
    expect(stderr).toContain("refusing to start");
    expect(stderr).toContain("DECKSMITH_TOKEN_FILE");
    expect(stderr).not.toContain("EADDRNOTAVAIL");
    expect(existsSync(work)).toBe(false);
  }, 15_000);

  /**
   * The HTML routes, from the build, because only the build has them: from
   * source, /examples/embed.html and /player.js are the 500s the route test
   * above describes.
   */
  it("F1: serves its pages unframeable but unsandboxed, and embed.html only with the token", async () => {
    const built = await builtServer();
    const { server } = built.createDeckServer({
      port: 0,
      host: "127.0.0.1",
      work: await scratch(),
      maxUploadBytes: 1 << 20,
      maxQueued: 4,
      ttlMs: 60_000,
      jobsPerHour: 100,
      requestsPerMinute: 1000,
      fetchRemoteFigures: false,
      sandboxDecks: true,
      removeDir: () => {},
      log: () => {},
      auth: KEYS,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(() => new Promise<void>((r) => server.close(() => r())));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const cookie = sessionFor(sessionBinding("127.0.0.1", port), cookieName(false, port));

    expect((await raw(base, "GET", "/examples/embed.html", {})).status).toBe(401);
    const player = await raw(base, "GET", "/player.js", {});
    expect(player.status).toBe(200);
    expect(player.headers["content-type"]).toMatch(/javascript/);

    const pages: [string, Raw, string][] = [
      ["embed.html", await raw(base, "GET", "/examples/embed.html", BEARER), "decksmith-player"],
      ["the login page", await raw(base, "GET", "/", {}), 'name="token"'],
      ["the uploader", await raw(base, "GET", "/", { cookie }), 'id="compose"'],
    ];
    for (const [what, page, marker] of pages) {
      expect(page.status, what).toBe(200);
      expect(page.text, what).toContain(marker);
      expect(page.headers["x-frame-options"], what).toBe("DENY");
      const csp = page.headers["content-security-policy"] ?? "";
      expect(csp, what).toContain("frame-ancestors 'none'");
      expect(csp, what).toContain("form-action 'self'");
      expect(csp, what).not.toContain("sandbox");
    }
    // F1: EMBED.HTML AND NOTHING ELSE CARRIES `connect-src 'none'`. It is the one
    // page a deck can steer a logged-in viewer into (see `EMBED_CSP`); the
    // uploader posts and polls, so it cannot have the directive and does not.
    expect(pages[0]?.[1].headers["content-security-policy"]).toContain("connect-src 'none'");
    for (const page of [pages[1], pages[2]]) {
      expect(page?.[1].headers["content-security-policy"]).not.toContain("connect-src");
    }
    // The real uploader, with the form that only a server with a token draws.
    expect(pages[2]?.[1].text).toContain('action="/logout"');
  });
});

/* -------------------------------------------------------------- the token gate */

describe("the token gate", () => {
  afterEach(closeServers);
  const authed = (over: Partial<ServeOptions> = {}) => serve({ auth: KEYS, ...over });
  const form = {
    "content-type": "application/x-www-form-urlencoded",
    "sec-fetch-site": "same-origin",
    origin: "null",
  };
  const credentials = (token: string) =>
    Buffer.from(new URLSearchParams({ username: "decksmith", token }).toString());

  it.each([
    ["GET", "/api/formats"],
    ["GET", "/api/jobs/<kept>"],
    ["GET", "/api/jobs/<kept>/events"],
    ["POST", "/api/jobs"],
    ["POST", "/api/jobs/<kept>/retry"],
    ["GET", "/examples/embed.html"],
    ["GET", "/nope"],
    ["PUT", "/d/x"],
    ["OPTIONS", "/api/jobs"],
  ])(
    "A1: %s %s without credentials is 401, the same 401, and nothing runs",
    async (method, template) => {
      const s = await authed();
      // A job a retry could resume, so a 401 is not merely the 404 it would have been.
      const kept = randomBytes(16).toString("base64url");
      await mkdir(join(s.work, kept), { recursive: true });
      await writeFile(
        join(s.work, kept, "job.json"),
        JSON.stringify({ filename: "p.md", fields: {}, createdAt: 0 }),
      );
      await writeFile(join(s.work, kept, "upload.bin"), "# P\n");
      const path = template.replace("<kept>", kept);

      const reference = await raw(s.base, "GET", "/api/formats", {});
      const big = method === "POST" && path === "/api/jobs";
      const res = big
        ? await raw(
            s.base,
            method,
            path,
            { "content-type": "multipart/form-data; boundary=x" },
            Buffer.alloc(1 << 20, 97),
            true,
          )
        : await raw(s.base, method, path, {});
      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toBe('Bearer realm="decksmith"');
      expect(res.text).toBe(reference.text);
      if (method !== "GET") expect(res.headers.connection).toBe("close");
      expect(s.queue.depth).toBe(0);
      expect(s.runs).toBe(0);
    },
  );

  it("A2: the public routes answer without credentials, and none of them sets a cookie", async () => {
    const s = await authed();
    const id = await deckOnDisk(s.work);
    const page = await raw(s.base, "GET", "/", {});
    expect(page.status).toBe(200);
    expect(page.text).toContain('name="token"');
    expect(page.text).toContain('autocomplete="current-password"');
    expect(page.text).not.toContain('id="compose"');
    expect(page.text).not.toContain("<script");
    expect(page.headers["cache-control"]).toBe("no-store");
    const player = await raw(s.base, "GET", "/player.js", {});
    expect(player.status).not.toBe(401);
    const decks = [
      await raw(s.base, "GET", `/d/${id}/deck.html`, {}),
      await raw(s.base, "HEAD", `/d/${id}/deck.html`, {}),
    ];
    for (const deck of decks) {
      expect(deck.status).toBe(200);
      expect(deck.headers["content-security-policy"]).toBe(DECK_CSP);
    }
    for (const r of [page, player, ...decks]) expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("A3: a bearer is the token or it is 401, whatever shape it arrives in", async () => {
    const s = await authed();
    const { body, contentType } = upload();
    const submit = (headers: Record<string, string>, path = "/api/jobs") =>
      raw(s.base, "POST", path, { ...headers, "content-type": contentType }, body);
    expect((await submit(BEARER)).status).toBe(202);
    expect((await submit({ authorization: `bearer ${TOKEN}` })).status).toBe(202);
    for (const authorization of [
      `Bearer ${TOKEN}x`,
      "Bearer k",
      `Bearer ${"k".repeat(10_000)}`,
      `Basic ${Buffer.from(`decksmith:${TOKEN}`).toString("base64")}`,
      "Bearer",
      `Bearer ${TOKEN} extra`,
    ]) {
      expect((await submit({ authorization })).status, authorization.slice(0, 24)).toBe(401);
    }
    expect((await submit({}, `/api/jobs?token=${TOKEN}`)).status).toBe(401);
  });

  it("A4: a wrong bearer beside a valid cookie is a wrong bearer", async () => {
    const s = await authed();
    const cookie = s.session();
    expect((await raw(s.base, "GET", "/api/formats", { cookie })).status).toBe(200);
    const both = await raw(s.base, "GET", "/api/formats", { cookie, authorization: "Bearer nope" });
    expect(both.status).toBe(401);
  });

  it("A5: logging in answers 303 to / with a Strict, HttpOnly cookie and the token nowhere", async () => {
    const s = await authed();
    const res = await raw(s.base, "POST", "/login", form, credentials(TOKEN));
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/");
    const set = res.headers["set-cookie"] ?? [];
    expect(set).toHaveLength(1);
    const cookie = parseSetCookie(set[0] as string);
    expect(cookie.name).toBe(s.cookie);
    expect(cookie.value).toMatch(/^\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(cookie.attrs).toEqual(
      expect.arrayContaining(["path=/", "httponly", "samesite=strict", "max-age=604800"]),
    );
    expect(cookie.attrs.filter((a) => a.startsWith("domain") || a === "secure")).toEqual([]);
    expect(JSON.stringify(res.headers) + res.text).not.toContain(TOKEN);
  });

  it("A6: a failed login is a 401 page that repeats nothing; a big one is 413; another site's is 403", async () => {
    const s = await authed();
    const wrong = await raw(s.base, "POST", "/login", form, credentials("TYPED-BY-SOMEONE-ELSE"));
    expect(wrong.status).toBe(401);
    expect(wrong.headers["content-type"]).toMatch(/text\/html/);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
    expect(wrong.text).toContain('name="token"');
    expect(wrong.text).toContain('role="alert"');
    expect(wrong.text).not.toContain("TYPED-BY-SOMEONE-ELSE");

    const big = await raw(s.base, "POST", "/login", form, Buffer.from(`token=${"a".repeat(5000)}`));
    expect(big.status).toBe(413);
    expect(big.headers["set-cookie"]).toBeUndefined();

    const cross = await raw(
      s.base,
      "POST",
      "/login",
      { ...form, "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      credentials(TOKEN),
    );
    expect(cross.status).toBe(403);
    expect(cross.headers["set-cookie"]).toBeUndefined();
  });

  it("A7: the cookie alone opens the uploader, a job, its events, and the no-script form", async () => {
    const s = await authed();
    const cookie = s.session();
    const page = await raw(s.base, "GET", "/", { cookie });
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="compose"');
    expect(page.text).toContain('action="/logout"');
    expect(page.headers.vary).toBe("Cookie");

    const { id } = await post(s.base, [{ name: "file", value: "# P\n", filename: "p.md" }], BEARER);
    expect((await raw(s.base, "GET", `/api/jobs/${id}`, { cookie })).status).toBe(200);
    const events = await raw(s.base, "GET", `/api/jobs/${id}/events`, { cookie });
    expect(events.headers["content-type"]).toBe("text/event-stream");
    expect(events.text).toMatch(/^data: /m);

    // What the uploader's own <form> sends with script off: K2's `Origin: null`.
    const { body, contentType } = upload();
    const noScript = await raw(
      s.base,
      "POST",
      "/api/jobs",
      {
        cookie,
        "content-type": contentType,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        origin: "null",
      },
      body,
    );
    expect(noScript.status).toBe(202);
  });

  it("A8: a cookie write with neither Sec-Fetch-Site nor Origin is refused; a bearer write is not", async () => {
    const s = await authed();
    const { body, contentType } = upload();
    const cookieWrite = await raw(
      s.base,
      "POST",
      "/api/jobs",
      { cookie: s.session(), "content-type": contentType },
      body,
    );
    expect(cookieWrite.status).toBe(403);
    expect(s.queue.depth).toBe(0);
    expect(s.runs).toBe(0);
    const bearerWrite = await raw(
      s.base,
      "POST",
      "/api/jobs",
      { ...BEARER, "content-type": contentType },
      body,
    );
    expect(bearerWrite.status).toBe(202);
  });

  it.each(CROSS_SITE)(
    "A9: a job submitted by %s is refused even with a valid session",
    async (_, headers) => {
      const s = await authed();
      const { body, contentType } = upload();
      const res = await raw(
        s.base,
        "POST",
        "/api/jobs",
        { ...headers, cookie: s.session(), "content-type": contentType },
        body,
      );
      expect(res.status).toBe(403);
      expect(res.error?.message).toMatch(/another site/);
      expect(s.queue.depth).toBe(0);
      expect(s.runs).toBe(0);
    },
  );

  it("A10: a session is its MAC and its expiry, and survives a restart", async () => {
    const t0 = 1_900_000_000_000;
    let clock = t0;
    const s = await authed({ now: () => clock });
    const name = s.cookie;
    const status = async (cookie: string, base = s.base) =>
      (await raw(base, "GET", "/api/formats", { cookie })).status;
    const login = await raw(s.base, "POST", "/login", form, credentials(TOKEN));
    const set = parseSetCookie((login.headers["set-cookie"] ?? [])[0] as string);
    const minted = set.value;
    const [exp = "", mac = ""] = minted.split(".");
    expect(Number(exp)).toBe(Math.floor(t0 / 1000) + 604_800);
    expect(set.name).toBe(name);
    expect(await status(`${name}=${minted}`)).toBe(200);

    expect(await status(`${name}=${Number(exp) + 1}.${mac}`)).toBe(401);
    expect(await status(`${name}=${mintSession(authKeys(`${TOKEN}-rotated`), t0, s.bind)}`)).toBe(
      401,
    );
    // A restart: a second server, the same token, no state shared. Its port
    // differs, so the cookie has to be re-minted for it — which is the point of
    // A10b below; what survives a restart is the KEY, not this exact value.
    const restarted = await authed({ now: () => clock });
    expect(await status(restarted.session(clock), restarted.base)).toBe(200);

    clock = Number(exp) * 1000 - 1000;
    expect(await status(`${name}=${minted}`)).toBe(200);
    clock = Number(exp) * 1000;
    expect(await status(`${name}=${minted}`)).toBe(401);

    // Minted further out than this server ever mints, past a minute of skew.
    clock = t0;
    expect(await status(`${name}=${mintSession(KEYS, t0 + 2 * 60_000, s.bind)}`)).toBe(401);
    expect(await status(`${name}=${mintSession(KEYS, t0 + 30_000, s.bind)}`)).toBe(200);

    expect(await status(`${name}=junk; ${name}=${minted}`)).toBe(200);
    expect(await status(`${name}=junk`)).toBe(401);
  });

  /**
   * A10b — THE COOKIE BELONGS TO ONE LISTENER, NOT TO THE HOST.
   *
   * RFC 6265 gives cookies no port, so everything on 127.0.0.1 shares one jar. A
   * second DeckSmith on this machine reading the same token file derives the
   * same `sessionKey`, and before the port went into the name and into the MAC
   * it would both overwrite this server's cookie in the browser and accept the
   * session this server minted. Both halves are checked: the names differ, and
   * each server refuses the other's value even when it is handed over under its
   * OWN name — which is what a captured cookie replayed by hand looks like.
   *
   * WHAT THIS DOES NOT DO is stop the other listener READING the cookie. The
   * browser sends it to every port on the host; see the README.
   */
  it("A10b: two servers on this host do not share a cookie name or a session", async () => {
    const a = await authed();
    const b = await authed();
    expect(a.cookie).not.toBe(b.cookie);
    expect(a.bind).not.toBe(b.bind);
    const status = (base: string, cookie: string) =>
      raw(base, "GET", "/api/formats", { cookie }).then((r) => r.status);
    expect(await status(a.base, a.session())).toBe(200);
    expect(await status(b.base, b.session())).toBe(200);
    // Each other's value, under the name the receiving server looks for.
    const relabel = (from: string, to: string) => `${to}${from.slice(from.indexOf("="))}`;
    expect(await status(b.base, relabel(a.session(), b.cookie))).toBe(401);
    expect(await status(a.base, relabel(b.session(), a.cookie))).toBe(401);
    // And under its own name, which is what the browser actually sends along.
    expect(await status(b.base, a.session())).toBe(401);
  });

  it("A11: logging out clears the cookie by name, and only for this site", async () => {
    const s = await authed();
    const out = await raw(s.base, "POST", "/logout", {
      cookie: s.session(),
      "sec-fetch-site": "same-origin",
      origin: "null",
    });
    expect(out.status).toBe(303);
    expect(out.headers.location).toBe("/");
    const cleared = parseSetCookie((out.headers["set-cookie"] ?? [])[0] as string);
    expect(cleared.name).toBe(s.cookie);
    expect(cleared.value).toBe("");
    expect(cleared.attrs).toEqual(
      expect.arrayContaining(["path=/", "httponly", "samesite=strict", "max-age=0"]),
    );
    const cross = await raw(s.base, "POST", "/logout", { "sec-fetch-site": "cross-site" });
    expect(cross.status).toBe(403);
    expect(cross.headers["set-cookie"]).toBeUndefined();
  });

  it("A12: ten wrong tokens refuse the eleventh even when it is right, for fifteen minutes", async () => {
    let clock = 1_900_000_000_000;
    const s = await authed({ now: () => clock });
    for (let i = 0; i < 10; i++) {
      expect((await raw(s.base, "POST", "/login", form, credentials(`wrong-${i}`))).status).toBe(
        401,
      );
    }
    expect((await raw(s.base, "POST", "/login", form, credentials(TOKEN))).status).toBe(429);
    expect((await raw(s.base, "GET", "/api/formats", BEARER)).status).toBe(429);
    // A cookie is not a guess, so it is not held back with them.
    expect((await raw(s.base, "GET", "/api/formats", { cookie: s.session(clock) })).status).toBe(
      200,
    );

    // A12b — THE LOCKOUT IS IN THE LOG, AND SO IS WHAT IT REFUSED. Silent before:
    // the owner of a loopback server that another local account had locked out
    // saw a 429 with no history behind it, and the correct tokens refused during
    // the window left no trace at all. Once per window for the lockout itself —
    // after the tenth failure nothing reaches the charge — and once per refusal.
    const log = s.logs.join("\n");
    expect(log.match(/ is locked out for 15 minutes after 10 wrong tokens/g)).toHaveLength(1);
    expect(log).toMatch(/^login: refused from .* — locked out$/m);
    expect(log).toMatch(/^auth: refused GET \/api\/formats from .* — locked out$/m);
    expect(log).not.toContain("SENTINEL");

    clock += 15 * 60_000;
    expect((await raw(s.base, "POST", "/login", form, credentials(TOKEN))).status).toBe(303);
  });

  it("A12: wrong bearers spend the same budget, and right ones spend none", async () => {
    const s = await authed();
    for (let i = 0; i < 50; i++) {
      expect((await raw(s.base, "GET", "/api/formats", BEARER)).status).toBe(200);
    }
    expect((await raw(s.base, "POST", "/login", form, credentials(TOKEN))).status).toBe(303);
    for (let i = 0; i < 5; i++) {
      expect((await raw(s.base, "POST", "/login", form, credentials(`wrong-${i}`))).status).toBe(
        401,
      );
      expect(
        (await raw(s.base, "GET", "/api/formats", { authorization: `Bearer wrong-${i}` })).status,
      ).toBe(401);
    }
    expect((await raw(s.base, "POST", "/login", form, credentials(TOKEN))).status).toBe(429);
    // Neither a missing credential nor a malformed one is a guess.
    expect((await raw(s.base, "GET", "/api/formats", {})).status).toBe(401);
  });

  it("A13: the log names refusals and never carries the token or a session", async () => {
    const s = await authed();
    const port = s.port;
    const session = parseSetCookie(
      ((await raw(s.base, "POST", "/login", form, credentials(TOKEN))).headers["set-cookie"] ??
        [])[0] as string,
    ).value;
    const cookie = `${s.cookie}=${session}`;
    await raw(s.base, "POST", "/login", form, credentials(`${TOKEN}-typo`));
    await raw(s.base, "GET", "/api/formats", BEARER);
    await raw(s.base, "GET", "/api/formats", { authorization: `Bearer ${TOKEN}x` });
    const { body, contentType } = upload();
    const job = await raw(
      s.base,
      "POST",
      "/api/jobs",
      { cookie, "content-type": contentType, "sec-fetch-site": "same-origin" },
      body,
    );
    const { id } = JSON.parse(job.text) as { id: string };
    await raw(s.base, "GET", `/api/jobs/${id}/events`, { cookie });
    await raw(s.base, "POST", "/api/jobs", { ...BEARER, "sec-fetch-site": "cross-site" });
    await raw(s.base, "GET", "/api/formats", { ...BEARER, host: `evil.example:${port}` });
    await raw(s.base, "GET", `/api/formats?token=${TOKEN}`, { cookie });
    const forced = await rawSocket(
      s.base,
      `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${TOKEN}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`,
    );
    expect(forced.status).toBe(500);

    const log = s.logs.join("\n");
    expect(log).toMatch(/^login: refused from /m);
    expect(log).toMatch(/^auth: wrong bearer on GET \/api\/formats from /m);
    expect(log).toMatch(/^refused: POST \/api\/jobs — Refused a request from another site/m);
    expect(log).toMatch(/^error: /m);
    expect(log).not.toContain("SENTINEL");
    expect(log).not.toContain(session);
    expect(log).not.toContain(session.split(".")[1] as string);
  });

  it("A14: the logout form is drawn only with a token, and a 401 stops the page's polling", () => {
    expect(uiPage({ auth: true })).toContain('action="/logout"');
    expect(uiPage()).not.toContain('action="/logout"');
    // The page as the browser receives it.
    const html = uiPage();
    const watch = /function watch\(id\)\{[\s\S]*?\n\}/.exec(html)?.[0] ?? "";
    const poll = /function poll\(\)\{[\s\S]*?\n {2}\}/.exec(watch)?.[0] ?? "";
    const loggedOut = /function loggedOut\(\)\{[\s\S]*?\n {2}\}/.exec(watch)?.[0] ?? "";
    const terminal = "if (r.status === 401) { loggedOut(); return null; }";
    expect(poll).toContain(terminal);
    // Once in poll, once in the first read, and nowhere that goes round again.
    expect(watch.split(terminal)).toHaveLength(3);
    expect(loggedOut).toContain("teardown();");
    expect(loggedOut).not.toContain("setTimeout");
    expect(loggedOut).toContain("keeps running on the server");
  });
});

/* ------------------------------------------------------- a certificate's names */

describe.skipIf(!TLS_OK)("an exposed bind, over https", () => {
  afterEach(closeServers);
  const exposed = (over: Partial<ServeOptions> = {}) =>
    serve({ host: "0.0.0.0", auth: KEYS, tls: TLS, ...over });

  it("H1: speaks TLS, and plain http gets no answer at all", async () => {
    const s = await exposed();
    const ok = await raw(s.base, "GET", "/api/formats", { ...BEARER, host: `deck.test:${s.port}` });
    expect(ok.status).toBe(200);
    const { body, contentType } = upload();
    const plain = await raw(
      `http://127.0.0.1:${s.port}`,
      "POST",
      "/api/jobs",
      { ...BEARER, "content-type": contentType },
      body,
    ).then(
      (r) => `HTTP ${r.status}`,
      (err: NodeJS.ErrnoException) => err.code,
    );
    // A TLS alert, or a reset: bytes no HTTP parser accepts, and never a status line.
    expect(plain).not.toMatch(/^HTTP/);
    expect(s.queue.depth).toBe(0);
    expect(s.runs).toBe(0);
  });

  it.each(["deck.test", "DECK.TEST", "a.wild.test", "127.0.0.1", "[::1]"])(
    "H2: answers to %s, which the certificate names",
    async (name) => {
      const s = await exposed();
      const res = await raw(s.base, "GET", "/api/formats", {
        ...BEARER,
        host: `${name}:${s.port}`,
      });
      expect(res.status).toBe(200);
    },
  );

  it.each(["evil.example", "b.a.wild.test", "cn-only.test", "10.0.0.6"])(
    "H2: refuses %s on a read and on a write, and lists the names it answers to",
    async (name) => {
      const s = await exposed();
      const host = `${name}:${s.port}`;
      const read = await raw(s.base, "GET", "/api/formats", { ...BEARER, host });
      expect(read.status).toBe(403);
      expect(read.error?.hint).toContain("DNS:deck.test, DNS:*.wild.test");
      const { body, contentType } = upload();
      const write = await raw(
        s.base,
        "POST",
        "/api/jobs",
        { ...BEARER, host, "content-type": contentType },
        body,
      );
      expect(write.status).toBe(403);
      expect(s.queue.depth).toBe(0);
      expect(s.runs).toBe(0);
    },
  );

  /**
   * An EMPTY Host reaches the handler and is refused there. An absent one is
   * refused there too over HTTP/1.0; over HTTP/1.1 Node answers 400 itself before
   * any handler runs (`requireHostHeader`), which is a refusal all the same.
   */
  it("H2: refuses an empty Host and a missing one", async () => {
    const s = await exposed();
    const auth = `Authorization: Bearer ${TOKEN}\r\n`;
    const empty = await rawSocket(
      s.base,
      `GET /api/formats HTTP/1.1\r\nHost:\r\n${auth}Connection: close\r\n\r\n`,
    );
    expect(empty.status).toBe(403);
    const emptyWrite = await rawSocket(
      s.base,
      `POST /api/jobs HTTP/1.1\r\nHost:\r\n${auth}Content-Length: 0\r\nConnection: close\r\n\r\n`,
    );
    expect(emptyWrite.status).toBe(403);
    expect((await rawSocket(s.base, `GET /api/formats HTTP/1.0\r\n${auth}\r\n`)).status).toBe(403);
    expect(
      (await rawSocket(s.base, `GET /api/formats HTTP/1.1\r\n${auth}Connection: close\r\n\r\n`))
        .status,
    ).toBe(400);
    expect(s.runs).toBe(0);
  });

  it("H3: without fetch metadata, the Origin a cookie write needs is the https one", async () => {
    const s = await exposed();
    const cookie = s.session();
    const host = `deck.test:${s.port}`;
    const { body, contentType } = upload();
    const submit = (origin: string) =>
      raw(s.base, "POST", "/api/jobs", { cookie, host, origin, "content-type": contentType }, body);
    expect((await submit(`https://${host}`)).status).toBe(202);
    expect((await submit(`http://${host}`)).status).toBe(403);
    // And over TLS the plain name is not the session's.
    // The same session under the name a PLAIN server would have set: over TLS
    // the `__Host-` name is the only one this server reads.
    const plainName = await raw(s.base, "GET", "/api/formats", {
      cookie: sessionFor(s.bind, cookieName(false, s.port)),
      host,
    });
    expect(plainName.status).toBe(401);
  });

  it("H4: logging in over https sets __Host-decksmith, Secure, on / and no Domain", async () => {
    const s = await exposed();
    const res = await raw(
      s.base,
      "POST",
      "/login",
      {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
        host: `deck.test:${s.port}`,
      },
      Buffer.from(`token=${TOKEN}`),
    );
    expect(res.status).toBe(303);
    const cookie = parseSetCookie((res.headers["set-cookie"] ?? [])[0] as string);
    expect(cookie.name).toBe(`__Host-decksmith-${s.port}`);
    expect(cookie.attrs).toEqual(
      expect.arrayContaining(["secure", "path=/", "httponly", "samesite=strict"]),
    );
    expect(cookie.attrs.filter((a) => a.startsWith("domain"))).toEqual([]);
  });

  it("H5: refuses TLS 1.1, and the refusal is the server's", async () => {
    const s = await exposed();
    const outcome = await new Promise<string>((resolve) => {
      const socket = tlsConnect({
        host: "127.0.0.1",
        port: s.port,
        ca: TLS_CERT,
        servername: "deck.test",
        minVersion: "TLSv1",
        maxVersion: "TLSv1.1",
        // OpenSSL 3 will not OFFER 1.1 at its default security level; without
        // this the client refuses itself and the test proves nothing about the
        // server. With it, what comes back is the server's protocol_version alert.
        ciphers: "DEFAULT@SECLEVEL=0",
      });
      socket.on("secureConnect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", (err: NodeJS.ErrnoException) => resolve(err.code ?? err.message));
    });
    expect(outcome).toBe("ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION");
  });
});

/* ------------------------------------------------------------------ framing */

describe("what may be framed", () => {
  afterEach(closeServers);

  /** [what, how to get it, the status it must be] — run with the token off and on. */
  const LOCKED: [
    string,
    (auth: boolean) => Promise<{ status: number; headers: Record<string, unknown> }>,
    number,
  ][] = [
    [
      "the format catalogue",
      async (auth) =>
        raw((await serve(auth ? { auth: KEYS } : {})).base, "GET", "/api/formats", BEARER),
      200,
    ],
    ["a 401", async () => raw((await serve({ auth: KEYS })).base, "GET", "/api/formats", {}), 401],
    [
      "a 403 for a name the server does not answer to",
      async (auth) => {
        const s = await serve(auth ? { auth: KEYS } : {});
        return raw(s.base, "GET", "/api/formats", { ...BEARER, host: `evil.example:${s.port}` });
      },
      403,
    ],
    [
      "a route 404",
      async (auth) =>
        raw((await serve(auth ? { auth: KEYS } : {})).base, "GET", "/api/nope", BEARER),
      404,
    ],
    [
      "a 413",
      async (auth) => {
        const s = await serve({ maxUploadBytes: 512, ...(auth ? { auth: KEYS } : {}) });
        const { body, contentType } = multipart([
          { name: "file", value: "#".repeat(2000), filename: "big.md" },
        ]);
        return raw(s.base, "POST", "/api/jobs", { ...BEARER, "content-type": contentType }, body);
      },
      413,
    ],
    [
      "a 429",
      async (auth) => {
        const s = await serve({ requestsPerMinute: 1, ...(auth ? { auth: KEYS } : {}) });
        await raw(s.base, "GET", "/api/formats", BEARER);
        return raw(s.base, "GET", "/api/formats", BEARER);
      },
      429,
    ],
    [
      "a 500",
      async (auth) => {
        const s = await serve(auth ? { auth: KEYS } : {});
        return rawSocket(
          s.base,
          `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nConnection: close\r\n\r\n`,
        );
      },
      500,
    ],
    [
      "a /d/ 400",
      async (auth) => {
        const s = await serve(auth ? { auth: KEYS } : {});
        return raw(s.base, "GET", `/d/${await deckOnDisk(s.work)}/%2e%2e%2fsecret.txt`, {});
      },
      400,
    ],
    [
      "a /d/ traversal in the id",
      async (auth) =>
        raw((await serve(auth ? { auth: KEYS } : {})).base, "GET", "/d/..%2f..%2fetc/passwd", {}),
      404,
    ],
    [
      "a /d/ file that is not there",
      async (auth) => {
        const s = await serve(auth ? { auth: KEYS } : {});
        return raw(s.base, "GET", `/d/${await deckOnDisk(s.work)}/nothing.html`, {});
      },
      404,
    ],
    [
      "a 416",
      async (auth) => {
        const s = await serve(auth ? { auth: KEYS } : {});
        return raw(s.base, "GET", `/d/${await deckOnDisk(s.work)}/assets/fig1.png`, {
          range: "bytes=100-",
        });
      },
      416,
    ],
  ];

  const cases = LOCKED.flatMap(([what, get, status]) =>
    [false, true].map((auth) => [what, auth, get, status] as const),
  ).filter(([what, auth]) => auth || what !== "a 401");

  it.each(cases)("F1: %s (token %s) is unframeable and sandboxed", async (_, auth, get, status) => {
    const res = await get(auth);
    expect(res.status).toBe(status);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    const csp = String(res.headers["content-security-policy"] ?? "");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/(^|; )sandbox($|;)/);
  });

  it.each([false, true])(
    "F1: the uploader and the login page are unframeable but not sandboxed (token %s)",
    async (auth) => {
      const s = await serve(auth ? { auth: KEYS } : {});
      const pages = [await raw(s.base, "GET", "/", auth ? { cookie: s.session() } : {})];
      if (auth) pages.push(await raw(s.base, "GET", "/", {}));
      for (const page of pages) {
        expect(page.status).toBe(200);
        expect(page.headers["content-type"]).toMatch(/text\/html/);
        expect(page.headers["x-frame-options"]).toBe("DENY");
        expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
        expect(page.headers["content-security-policy"]).not.toContain("sandbox");
      }
    },
  );

  it.each([false, true])(
    "F2: a deck answer carries today's CSP exactly and no X-Frame-Options (token %s)",
    async (auth) => {
      const s = await serve(auth ? { auth: KEYS } : {});
      const id = await deckOnDisk(s.work);
      const answers: [string, Raw, number][] = [
        ["GET", await raw(s.base, "GET", `/d/${id}/deck.html`, {}), 200],
        [
          "range",
          await raw(s.base, "GET", `/d/${id}/assets/fig1.png`, { range: "bytes=0-2" }),
          206,
        ],
        ["HEAD", await raw(s.base, "HEAD", `/d/${id}/deck.html`, {}), 200],
      ];
      for (const [what, res, status] of answers) {
        expect(res.status, what).toBe(status);
        expect(res.headers["content-security-policy"], what).toBe(DECK_CSP);
        expect(res.headers["x-frame-options"], what).toBeUndefined();
      }
    },
  );

  it("F2: with the deck sandbox off, a deck carries neither header, and a /d/ error keeps both", async () => {
    const s = await serve({ sandboxDecks: false });
    const id = await deckOnDisk(s.work);
    const deck = await raw(s.base, "GET", `/d/${id}/deck.html`, {});
    expect(deck.status).toBe(200);
    expect(deck.headers["content-security-policy"]).toBeUndefined();
    expect(deck.headers["x-frame-options"]).toBeUndefined();
    const missing = await raw(s.base, "GET", `/d/${id}/nothing.html`, {});
    expect(missing.headers["x-frame-options"]).toBe("DENY");
  });
});

/* -------------------------------------------------------- the token, in Chrome */

/**
 * What only a browser can say: that the cookie attributes, fetch metadata,
 * `frame-ancestors` and `X-Frame-Options` do in Chrome what the tests above
 * assume they do. Two of those were rated medium-high and unmeasured in the
 * design; B1 and B4 are the measurement, each with its control.
 *
 * `localhost` and `127.0.0.1` are DIFFERENT SITES to a browser, so a fixture
 * server reached as `localhost` is another site's page.
 */
describe.skipIf(chrome === null)("the token, in the renderer's own browser", () => {
  let browser: Browser;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    const { default: puppeteer } = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: chrome as string,
      headless: true,
      args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
    });
  }, 60_000);
  afterAll(async () => {
    await browser?.close().catch(() => {});
  });
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close().catch(() => {});
    await closeServers();
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const never = () => new Promise<JobResult>(() => {});

  /** Every request the server saw, with the cookie it carried. */
  function watchRequests(server: Server | TlsServer) {
    const seen: { method: string; url: string; cookie: string | undefined }[] = [];
    (server as Server).on("request", (req: IncomingMessage) =>
      seen.push({ method: req.method ?? "", url: req.url ?? "", cookie: req.headers.cookie }),
    );
    return seen;
  }

  async function fresh(): Promise<Page> {
    const context = await browser.createBrowserContext();
    contexts.push(context);
    return context.newPage();
  }

  /** Through the real page, as a person does. */
  async function logIn(page: Page, base: string): Promise<void> {
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.type('input[name="token"]', TOKEN);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.click('button[type="submit"]'),
    ]);
  }

  async function elsewhere(pages: Record<string, string>): Promise<string> {
    const server = createServer((req, res) => {
      const body = pages[req.url ?? ""];
      res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
      res.end(body ?? "");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(
      () =>
        new Promise<void>((r) => {
          server.closeAllConnections();
          server.close(() => r());
        }),
    );
    return `http://localhost:${(server.address() as AddressInfo).port}`;
  }

  /** A stub deck whose script frames `src` and posts a job through that frame's own fetch. */
  const PROBE = `<!doctype html><meta charset="utf-8"><title>probe</title><body><script>
window.probe = function (src) {
  return new Promise(function (resolve) {
    var f = document.createElement("iframe");
    var done = false;
    function go() {
      if (done) return;
      done = true;
      var fd = new FormData();
      fd.append("url", "https://example.com/borrowed");
      try {
        f.contentWindow.fetch("/api/jobs", { method: "POST", body: fd }).then(
          function (r) { resolve("status " + r.status); },
          function (e) { resolve("rejected " + e.name); });
      } catch (e) { resolve("unreachable " + e.name); }
    }
    f.onload = function () { setTimeout(go, 200); };
    setTimeout(go, 5000);
    f.src = src;
    document.body.appendChild(f);
  });
};
</script>`;

  it.each([
    ["with the framing headers", true],
    ["CONTROL, with them taken off", false],
  ])(
    "B1: a deck opened top-level borrows no same-origin frame to post a job, %s",
    async (_, frameHeaders) => {
      const s = await serve({ auth: KEYS, frameHeaders, run: never });
      const id = await deckOnDisk(s.work, PROBE);
      // One job holds the runner, so every job accepted after it shows in depth.
      expect(
        (await post(s.base, [{ name: "url", value: "https://example.com/hold" }], BEARER)).status,
      ).toBe(202);
      const page = await fresh();
      await logIn(page, s.base);
      await page.goto(`${s.base}/d/${id}/deck.html`, { waitUntil: "load" });
      const outcomes: string[] = [];
      for (const src of ["/", "/api/formats"]) {
        outcomes.push(
          `${src}: ${await page.evaluate((u) => (window as unknown as { probe: (s: string) => Promise<string> }).probe(u), src)}`,
        );
      }
      if (frameHeaders) {
        expect(s.queue.depth, outcomes.join(" | ")).toBe(0);
        expect(outcomes.join(" "), outcomes.join(" | ")).not.toContain("status 202");
      } else {
        expect(s.queue.depth, outcomes.join(" | ")).toBeGreaterThan(0);
        expect(outcomes.join(" ")).toContain("status 202");
      }
    },
    60_000,
  );

  it("B2: logs in through the form, uploads with the page's fetch, follows SSE, and shows the deck", async () => {
    const s = await serve({
      auth: KEYS,
      run: async (job) => {
        for (const stage of ["ingest", "plan"] as const) {
          job.begin(stage);
          await sleep(500);
          job.done(stage);
        }
        job.begin("build");
        await mkdir(join(job.dir, "deck"), { recursive: true });
        await writeFile(join(job.dir, "deck", "deck.html"), "<h1>deck</h1>");
        job.done("build");
        return { deckUrl: `/d/${job.id}/deck.html`, slides: 4, duration: 12, warnings: [] };
      },
    });
    const seen = watchRequests(s.server);
    const page = await fresh();
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await logIn(page, s.base);
    expect(await page.$("#compose")).not.toBeNull();

    const session = (await page.browserContext().cookies()).find((c) => c.name === s.cookie);
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Strict");

    const doc = join(await scratch(), "paper.md");
    await writeFile(doc, "# Paper\n\nProse.\n");
    const input = await page.$("#fileinput");
    await (input as unknown as { uploadFile: (p: string) => Promise<void> }).uploadFile(doc);
    await page.waitForFunction(
      () => !(document.getElementById("go") as HTMLButtonElement).disabled,
    );
    await page.click("#go");
    await page.waitForFunction(() => document.getElementById("v-done")?.hidden === false, {
      timeout: 30_000,
    });
    const heading = await page.waitForFunction(
      () =>
        (
          document.querySelector("#d-canvas iframe") as HTMLIFrameElement | null
        )?.contentDocument?.querySelector("h1")?.textContent,
      { timeout: 15_000 },
    );
    expect(await heading.jsonValue()).toBe("deck");

    const events = seen.filter((r) => r.url.endsWith("/events"));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((r) => r.cookie?.startsWith(`${s.cookie}=`))).toBe(true);
    expect(seen.filter((r) => r.method === "POST" && r.url === "/api/jobs")).toHaveLength(1);
    expect(urls.filter((u) => u.includes(TOKEN))).toEqual([]);
    expect(seen.filter((r) => r.url.includes(TOKEN))).toEqual([]);
  }, 60_000);

  it("B3: with JavaScript off, the login form and the upload form both work", async () => {
    const s = await serve({ auth: KEYS });
    const page = await fresh();
    await page.setJavaScriptEnabled(false);
    await logIn(page, s.base);
    expect(await page.$("#compose")).not.toBeNull();
    await page.type("#url", "https://example.com/paper");
    // The submit button is `disabled` in the markup and enabled by script, so
    // nothing a person without script can click. What the no-script path IS is
    // the form: remove the attribute through the DOM agent, not page script,
    // and let a real click submit it natively.
    const cdp = await page.createCDPSession();
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#go",
    });
    await cdp.send("DOM.removeAttribute", { nodeId, name: "disabled" });
    const [response] = await Promise.all([page.waitForNavigation(), page.click("#go")]);
    expect(response?.status()).toBe(202);
    expect(response?.request().headers()["sec-fetch-site"]).toBe("same-origin");
  }, 60_000);

  it("B4: another site's page cannot post a job as the viewer, or open embed.html as them", async () => {
    const s = await serve({ auth: KEYS, run: never });
    const id = await deckOnDisk(s.work);
    expect(
      (await post(s.base, [{ name: "url", value: "https://example.com/hold" }], BEARER)).status,
    ).toBe(202);
    const seen = watchRequests(s.server);
    const evil = await elsewhere({
      "/post": `<!doctype html><form id="f" method="post" action="${s.base}/api/jobs" enctype="multipart/form-data"><input name="url" value="https://example.com/csrf"></form><script>document.getElementById("f").submit()</script>`,
      "/embed": `<!doctype html><script>location.href = ${JSON.stringify(`${s.base}/examples/embed.html?a=/d/${id}/`)}</script>`,
    });
    const page = await fresh();
    await logIn(page, s.base);

    // CONTROL: from its own site the session does reach embed.html (a 500 from
    // a source tree, which has no dist/embed.html; never a 401).
    const own = await page.goto(`${s.base}/examples/embed.html`);
    expect(own?.status()).not.toBe(401);

    const posted = page.waitForResponse((r) => r.url() === `${s.base}/api/jobs`);
    await page.goto(`${evil}/post`).catch(() => {});
    expect((await posted).status()).toBe(403);
    expect(s.queue.depth).toBe(0);

    const before = seen.length;
    const embedded = page.waitForResponse((r) =>
      r.url().startsWith(`${s.base}/examples/embed.html?`),
    );
    await page.goto(`${evil}/embed`).catch(() => {});
    expect((await embedded).status()).toBe(401);
    await sleep(1000);
    const after = seen.slice(before);
    expect(after.find((r) => r.url.startsWith("/examples/embed.html?"))?.cookie).toBeUndefined();
    expect(after.filter((r) => r.url.startsWith("/d/"))).toEqual([]);
  }, 60_000);

  /**
   * B7 — A DECK CANNOT WALK THE VIEWER INTO embed.html AND SPEND AS THEM.
   *
   * REVIEWER 2'S FINDING, MEASURED HERE BOTH WAYS. B4 showed that a cross-site
   * navigation to `/examples/embed.html?a=…` arrives with no cookie and gets 401,
   * and the PR read that as "another site cannot steer a logged-in viewer into a
   * deck that uses the session". It does not follow. `SameSite=Strict` withholds
   * the cookie from a navigation ANOTHER SITE starts; it sends it on one THIS
   * origin starts. A deck opened top-level — from a link on any site, since /d/
   * is public — is its own top-level document, so it can set `location` itself,
   * and that second navigation is same-site. It lands on embed.html as the
   * logged-in viewer, with the attacker's own deck framed inside a page that is
   * same-origin with it, and `parent.fetch` then runs under EMBED.HTML's policy.
   *
   * So the test asserts the steering and the refusal separately, because they are
   * separate facts and only the second one is new:
   *
   *   1. the navigation happens and DOES carry the session — `SameSite=Strict`
   *      never stopped it, and this is the half the PR had wrong;
   *   2. the fetch is refused all the same, because `EMBED_CSP` gives that one
   *      page `connect-src 'none'`. No job is queued.
   *
   * THE BUILT SERVER, not the source one: from a source tree /examples/embed.html
   * is a 500 (there is no src/embed.html), so a source server would "pass" this
   * by serving nothing at all. `npm ci` builds dist/ through `prepare`.
   */
  it("B7: a deck steers the viewer into embed.html with their session, and still cannot spend it", async () => {
    const built = await builtServer();
    const STEER = `<!doctype html><meta charset="utf-8"><title>steer</title><body><script>
if (window.top === window) {
  location.href = "/examples/embed.html?a=" +
    encodeURIComponent(location.pathname.replace(/deck\\.html$/, ""));
} else {
  var fd = new FormData();
  fd.append("url", "https://example.com/steered");
  try {
    parent.fetch("/api/jobs", { method: "POST", body: fd }).then(
      function (r) { parent.__steer = "status " + r.status; },
      function (e) { parent.__steer = "rejected " + e.name; });
  } catch (e) { parent.__steer = "threw " + e.name; }
}
</script>`;
    const s = await serve({ auth: KEYS, run: never }, built.createDeckServer);
    const id = await deckOnDisk(s.work, STEER);
    // One job holds the runner, so anything accepted afterwards shows in depth.
    expect(
      (await post(s.base, [{ name: "url", value: "https://example.com/hold" }], BEARER)).status,
    ).toBe(202);
    const page = await fresh();
    await logIn(page, s.base);
    const seen = watchRequests(s.server);

    // FROM ANOTHER SITE'S LINK, which is the case the claim was about.
    const evil = await elsewhere({
      "/link": `<!doctype html><script>location.href = ${JSON.stringify(`${s.base}/d/${id}/deck.html`)}</script>`,
    });
    const steered = page.waitForResponse((r) =>
      r.url().startsWith(`${s.base}/examples/embed.html?`),
    );
    await page.goto(`${evil}/link`).catch(() => {});
    expect((await steered).status()).toBe(200);

    // 1. The deck's own navigation carried the session. The cross-site hop that
    //    started the chain did not — that is B4, and it is still true.
    const embed = seen.find((r) => r.url.startsWith("/examples/embed.html?"));
    expect(embed?.cookie).toContain(`${s.cookie}=`);
    expect(seen.find((r) => r.url === `/d/${id}/deck.html`)?.cookie).toBeUndefined();

    // 2. And the framed deck's `parent.fetch` was refused by embed.html's CSP.
    const outcome = await page
      .waitForFunction(() => (window as unknown as { __steer?: string }).__steer, {
        timeout: 20_000,
      })
      .then((handle) => handle.jsonValue());
    expect(outcome).toMatch(/^rejected /);
    await sleep(1000);
    expect({ outcome, depth: s.queue.depth, runs: s.runs }).toEqual({
      outcome,
      depth: 0,
      runs: 1,
    });
  }, 60_000);

  it("B5: another site may frame a deck, and the deck's request carries no cookie", async () => {
    const s = await serve({ auth: KEYS });
    const id = await deckOnDisk(s.work);
    const seen = watchRequests(s.server);
    const evil = await elsewhere({
      "/frame": `<!doctype html><iframe src="${s.base}/d/${id}/deck.html"></iframe>`,
    });
    const page = await fresh();
    await logIn(page, s.base);
    const framed = page.waitForResponse((r) => r.url() === `${s.base}/d/${id}/deck.html`);
    await page.goto(`${evil}/frame`, { waitUntil: "load" });
    expect((await framed).status()).toBe(200);
    const request = seen.find((r) => r.url === `/d/${id}/deck.html`);
    expect(request).toBeDefined();
    expect(request?.cookie).toBeUndefined();
  }, 60_000);

  it("B6: when the cookie goes mid-job, the page says so and stops polling", async () => {
    const s = await serve({ auth: KEYS, run: never });
    const seen = watchRequests(s.server);
    const page = await fresh();
    // POLLING, not SSE. An open stream was authorised when it connected and runs
    // to the job's end by design; the path that could loop is the poll, so it is
    // the one forced here.
    await page.evaluateOnNewDocument(() => {
      (window as unknown as { EventSource?: unknown }).EventSource = undefined;
    });
    await logIn(page, s.base);
    await page.type("#url", "https://example.com/paper");
    await page.waitForFunction(
      () => !(document.getElementById("go") as HTMLButtonElement).disabled,
    );
    await page.click("#go");
    const polls = () =>
      seen.filter((r) => r.method === "GET" && /^\/api\/jobs\/[^/]+$/.test(r.url)).length;
    for (let i = 0; i < 100 && polls() < 3; i++) await sleep(200);
    expect(polls()).toBeGreaterThanOrEqual(3);

    const context = page.browserContext();
    await context.deleteCookie(...(await context.cookies()));
    await page.waitForFunction(
      () =>
        document.getElementById("v-error")?.hidden === false &&
        document.getElementById("e-where")?.textContent === "Logged out",
      { timeout: 20_000 },
    );
    expect(await page.$eval("#e-hint", (e) => e.textContent)).toMatch(
      /keeps running on the server/,
    );
    const stopped = polls();
    await sleep(5000);
    expect(polls()).toBe(stopped);
  }, 60_000);

  /**
   * M1 — A MEASUREMENT OF A KNOWN HOLE, PINNED SO THE README STAYS TRUE.
   *
   * A deck shown INSIDE the uploader is same-origin with it, and `parent.fetch`
   * runs under the uploader's policy, not the deck's `connect-src 'none'`. The
   * answer recorded in .planning/2026-09-18-deck-parent-reach.md is that it
   * reaches: a job is queued as the logged-in viewer. When decks move to their
   * own origin this should flip, and the README's "What is missing" with it.
   */
  it("M1: a deck shown inside the uploader can still reach its parent's fetch", async () => {
    const REACH = `<!doctype html><meta charset="utf-8"><h1>deck</h1><script>
(function () {
  var fd = new FormData();
  fd.append("url", "https://example.com/from-the-deck");
  try {
    parent.fetch("/api/jobs", { method: "POST", body: fd }).then(
      function (r) { parent.__reach = "status " + r.status; },
      function (e) { parent.__reach = "rejected " + e.name; });
  } catch (e) { parent.__reach = "threw " + e.name; }
})();
</script>`;
    let first = true;
    const s = await serve({
      auth: KEYS,
      run: async (job) => {
        if (!first) return never();
        first = false;
        await mkdir(join(job.dir, "deck"), { recursive: true });
        await writeFile(join(job.dir, "deck", "deck.html"), REACH);
        return { deckUrl: `/d/${job.id}/deck.html`, slides: 1, duration: 1, warnings: [] };
      },
    });
    const page = await fresh();
    await logIn(page, s.base);
    await page.type("#url", "https://example.com/paper");
    await page.waitForFunction(
      () => !(document.getElementById("go") as HTMLButtonElement).disabled,
    );
    await page.click("#go");
    const reach = await page.waitForFunction(
      () => (window as unknown as { __reach?: string }).__reach,
      {
        timeout: 30_000,
      },
    );
    const outcome = await reach.jsonValue();
    for (let i = 0; i < 50 && s.runs < 2; i++) await sleep(100);
    expect({ outcome, runs: s.runs }).toEqual({ outcome: "status 202", runs: 2 });
  }, 60_000);

  /**
   * M2 — ANOTHER PORT ON THIS HOST IS SENT THE SESSION COOKIE, AND ALWAYS WILL BE.
   *
   * Pinned for the same reason M1 is: the README makes a claim about it and the
   * claim has to stay true. RFC 6265 §1 gives cookies no port — "cookies for a
   * given host are shared across all the ports on that host" — so every listener
   * on 127.0.0.1 is handed this server's cookie by the browser, and a value read
   * out of that header replays against this server from a script until it
   * expires. Naming the cookie `decksmith-<port>` does not change it and was
   * never meant to (A10b says what it does change); nothing inside this server
   * can change it, because the decision is the browser's.
   *
   * If this ever flips — a browser shipping port-scoped cookies, or /d/ and the
   * API moving to separate origins with a `__Host-` cookie that cannot leave
   * one — the README's "What a same-host attacker can still do" changes with it.
   */
  it("M2: every other listener on this host is sent the session cookie", async () => {
    const s = await serve({ auth: KEYS });
    const sent: (string | undefined)[] = [];
    const neighbour = createServer((req, res) => {
      sent.push(req.headers.cookie);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html>neighbour");
    });
    await new Promise<void>((r) => neighbour.listen(0, "127.0.0.1", r));
    servers.push(
      () =>
        new Promise<void>((r) => {
          neighbour.closeAllConnections();
          neighbour.close(() => r());
        }),
    );
    const port = (neighbour.address() as AddressInfo).port;
    expect(port).not.toBe(s.port);

    const page = await fresh();
    await logIn(page, s.base);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    // Same host, different port, and the cookie goes anyway — under this
    // server's name, with this server's value.
    expect(sent.some((c) => c?.includes(`${s.cookie}=`))).toBe(true);
  }, 60_000);
});

/* ---------------------------------------------------------------- the pipeline */

describe("ingest, against real documents", () => {
  /**
   * The pipeline's ingest stage is exercised through the real `runPipeline` with
   * a planner that never runs — every assertion here is about what happens
   * BEFORE `plan`, which is where hostile input is dealt with. Reaching `plan`
   * at all is the signal that ingest was happy.
   */
  async function ingest(upload: { filename: string; bytes: Uint8Array }) {
    const { runPipeline } = await import("../src/server/pipeline.js");
    const dir = await scratch();
    const log: string[] = [];
    const reached: string[] = [];
    const handle: JobHandle = {
      id: "test",
      dir,
      begin: (s) => {
        reached.push(s);
        if (s === "plan") throw new Error("STOP: reached plan");
      },
      done: () => {},
      skip: () => {},
      log: (l) => log.push(l),
    };
    let error: Error | undefined;
    await runPipeline(handle, {
      upload: { ...upload, fields: {} },
      options: parseOptions({}),
      fetchRemoteFigures: false,
    }).catch((e: Error) => {
      error = e;
    });
    return { dir, log, reached, error };
  }

  it("reads a plain markdown upload and writes a source.json", async () => {
    const out = await ingest({
      filename: "paper.md",
      bytes: bytes("# Title\n\nProse.\n\n## Two\n\nMore.\n"),
    });
    expect(out.error?.message).toBe("STOP: reached plan");
    const source = JSON.parse(await readFile(join(out.dir, "src", "source.json"), "utf8")) as {
      title: string;
      sections: unknown[];
    };
    expect(source.title).toBe("Title");
    expect(source.sections).toHaveLength(2);
  });

  it("refuses a document with no headings, and says what to add", async () => {
    const out = await ingest({ filename: "notes.md", bytes: bytes("just prose, no structure") });
    expect(out.error?.message).toMatch(/no headings/);
    expect((out.error as UploadError).hint).toMatch(/# Heading/);
  });

  it("refuses a file that is not markdown by extension", async () => {
    const out = await ingest({ filename: "paper.pdf", bytes: bytes("%PDF-1.4 ...") });
    expect(out.error?.message).toMatch(/is a \.pdf file/);
  });

  it("unpacks a zip and reads the markdown inside it", async () => {
    const zip = zipSync({
      "paper/figures/a.png": bytes("x"),
      "paper/paper.md": bytes("# Zipped\n\nProse.\n"),
    });
    const out = await ingest({ filename: "paper.zip", bytes: zip });
    expect(out.error?.message).toBe("STOP: reached plan");
    expect(out.log.join(" ")).toMatch(/unpacked 2 file\(s\), reading paper\/paper\.md/);
    expect(await readFile(join(out.dir, "upload", "paper", "figures", "a.png"), "utf8")).toBe("x");
  });

  it("will not read a figure that points outside the upload", async () => {
    // The document is the attacker here: `fetchFigures` does `readFile(src)` on
    // anything that is not an http URL, so an unguarded server would read this.
    const out = await ingest({
      filename: "paper.md",
      bytes: bytes("# Title\n\n![key](../../../../etc/ssh/ssh_host_rsa_key)\n"),
    });
    expect(out.error?.message).toBe("STOP: reached plan");
    const source = JSON.parse(await readFile(join(out.dir, "src", "source.json"), "utf8")) as {
      figures: unknown[];
    };
    expect(source.figures).toEqual([]);
  });

  it("leaves a remote figure out while remote fetching is off, and says which", async () => {
    const out = await ingest({
      filename: "paper.md",
      bytes: bytes("# Title\n\n![meta](http://169.254.169.254/latest/meta-data/)\n"),
    });
    expect(out.error?.message).toBe("STOP: reached plan");
    const source = JSON.parse(await readFile(join(out.dir, "src", "source.json"), "utf8")) as {
      figures: unknown[];
    };
    expect(source.figures).toEqual([]);
  });
});

/**
 * The SSRF guard on its own, because its verdict is only ever a warning string
 * and warnings do not reach a `JobHandle` — a whole `runPipeline` cannot show
 * which rule fired. Nothing here opens a socket: `guardFigures` resolves and
 * judges, and `dns.lookup` on a literal address answers without a query.
 */
describe("guardFigures", () => {
  const figures = (n: number, host: string) =>
    parseMarkdown(
      `# Title\n\n${Array.from({ length: n }, (_, i) => `![f${i}](http://${host}/i${i}.png)`).join("\n\n")}\n`,
    );

  it("charges the remote budget only for figures that pass", async () => {
    const source = figures(45, "169.254.169.254");
    expect(source.figures).toHaveLength(45);
    const warnings: string[] = [];
    const out = await guardFigures(source, await scratch(), true, warnings);
    expect(out.figures).toEqual([]);
    /**
     * THE REGRESSION. The counter used to be incremented BEFORE `reachable`, so
     * a refusal spent the allowance: from the 41st figure on, the warning
     * stopped naming the address and started saying "more than 40 remote
     * figures". A hostile page listing forty private addresses — free to write —
     * therefore exhausted the budget before one legal figure was considered, and
     * the deck came out with none of its images.
     */
    expect(warnings).toHaveLength(45);
    expect(warnings.filter((w) => /more than 40 remote figures/.test(w))).toEqual([]);
    expect(warnings.every((w) => /resolves to a private address \(169/.test(w))).toBe(true);
  });

  it("still caps how many remote figures it will keep", async () => {
    // A literal public address, so `dns.lookup` short-circuits and this stays
    // offline. `guardFigures` only decides; it is `fetchFigures` that would
    // fetch, and it never runs here.
    const warnings: string[] = [];
    const out = await guardFigures(figures(45, "93.184.216.34"), await scratch(), true, warnings);
    expect(out.figures).toHaveLength(40);
    expect(warnings).toHaveLength(5);
    expect(warnings.every((w) => /more than 40 remote figures/.test(w))).toBe(true);
  });

  it("leaves every remote figure out while remote fetching is off", async () => {
    const warnings: string[] = [];
    const out = await guardFigures(figures(3, "example.com"), await scratch(), false, warnings);
    expect(out.figures).toEqual([]);
    expect(warnings.every((w) => /does not fetch remote figures/.test(w))).toBe(true);
  });
});

/**
 * The URL path, end to end, against a fixture server on loopback.
 *
 * Reaching loopback at all needs `allowLoopback`, which is `fetchGuarded`'s
 * declared test seam — `PipelineInput.harvest` is how it gets there and nothing
 * in src/ passes it. A browser is required, and CI has none, so this is gated
 * exactly the way test/harvest.test.ts gates its own browser half. It stops at
 * `plan` like the ingest suite above: everything this path has to get right has
 * already happened by then.
 */
describe.skipIf(chrome === null)("a url job, against a local fixture server", () => {
  const shut: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of shut.splice(0)) await close();
  });

  /** Signature, IHDR type and the two extents — everything `imageSize` reads. */
  function png(width: number, height: number): Buffer {
    const b = Buffer.alloc(24);
    b.write("\x89PNG\r\n\x1a\n", 0, "latin1");
    b.write("IHDR", 12, "latin1");
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
  }

  async function fixture(): Promise<string> {
    const image = png(200, 120);
    const server = createServer((req, res) => {
      if (req.url === "/fig.png") {
        res.writeHead(200, { "content-type": "image/png", "content-length": image.length });
        res.end(image);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><head><title>Sparse attention</title></head><body><article>" +
          "<h1>Sparse attention</h1><p>The pipeline is drawn in Figure 1.</p>" +
          '<figure><img src="/fig.png" alt="the pipeline">' +
          "<figcaption>Figure 1 &mdash; end to end</figcaption></figure>" +
          "<h2>Results</h2><p>It is faster than the dense baseline.</p>" +
          "</article></body></html>",
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    shut.push(() => new Promise<void>((r) => server.close(() => r())));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }

  it("harvests the page into a source with its figure beside it", async () => {
    const { runPipeline } = await import("../src/server/pipeline.js");
    const url = await fixture();
    const dir = await scratch();
    const log: string[] = [];
    const handle: JobHandle = {
      id: "test",
      dir,
      begin: (s) => {
        if (s === "plan") throw new Error("STOP: reached plan");
      },
      done: () => {},
      skip: () => {},
      log: (l) => log.push(l),
    };
    const error = await runPipeline(handle, {
      url,
      options: parseOptions({}),
      // OFF, and it makes no difference: the harvest has already turned the
      // page's image into a local file, so nothing downstream sees a URL.
      fetchRemoteFigures: false,
      harvest: { allowLoopback: true },
    }).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error?.message).toBe("STOP: reached plan");
    expect(log.join(" ")).toMatch(/harvested http:\/\/127\.0\.0\.1/);

    const source = JSON.parse(await readFile(join(dir, "src", "source.json"), "utf8")) as {
      title: string;
      sections: unknown[];
      figures: { src: string; caption: string; width: number; height: number }[];
    };
    expect(source.title).toBe("Sparse attention");
    expect(source.sections.length).toBeGreaterThan(1);
    /**
     * THE FIGURE IS THE ASSERTION THAT MATTERS. `harvest` writes its assets to
     * ABSOLUTE paths and cites them that way, and `guardFigures` used to resolve
     * every non-URL src as relative to the upload root — which turned
     * `/var/.../upload/assets/a.png` into `<root>/var/...` and dropped the
     * figure as "not in the upload" on every URL job, silently, with the deck
     * still building.
     */
    expect(source.figures).toHaveLength(1);
    expect(source.figures[0]).toMatchObject({
      caption: "Figure 1 — end to end",
      width: 200,
      height: 120,
    });
    const asset = await readFile(join(dir, "src", "assets", source.figures[0]?.src ?? ""));
    expect(asset.length).toBe(24);
  });
});

describe("illustrate, between plan and build", () => {
  /**
   * The one run in this file that gets PAST `plan`, and it does so without a
   * Codex: the planner's `Runner` is the recorded-answer seam plan.test.ts
   * drives, and the chain is the tool's own SVG — the rung that cannot fail, so
   * nothing here opens a socket. `build` is where it stops: `buildDeck` reads
   * dist/deck-runtime.js beside the bundle, which a source-tree test does not
   * have, and by then everything `illustrate` promises is on disk and in the
   * log. The assertions are those promises: the figure registered in the source
   * the pipeline wrote, the slot pointing at it in the storyboard it wrote, the
   * file itself under src/assets, and the objects handed on — which is what a
   * `build` reached at all is evidence of, since `assertRefsResolve` would have
   * refused a slot that still had no figure.
   */
  const text = "# Title\n\nProse.\n\n## Two\n\nMore.\n";
  const planWithABrief = () => ({
    // `ingest` derives the id from the bytes the same way; a mismatch is a
    // dangling reference and the plan is refused.
    sourceId: parseMarkdown(text).id,
    title: "Title",
    beats: [
      {
        id: "b01",
        intent: "Refinement is a loop.",
        weight: 0.8,
        archetype: "claim-figure",
        params: {
          headline: "One loop, four steps",
          claim: "Refinement is a loop.",
          illustration: { prompt: "four gears in a ring", caption: "The loop" },
        },
      },
    ],
  });

  async function run(fields: Record<string, string>) {
    const { runPipeline } = await import("../src/server/pipeline.js");
    const dir = await scratch();
    const log: string[] = [];
    const steps: string[] = [];
    const handle: JobHandle = {
      id: "test",
      dir,
      begin: (s) => {
        steps.push(`${s}: begin`);
        if (s === "build") throw new Error("STOP: reached build");
      },
      done: (s, detail) => steps.push(`${s}: done — ${detail ?? ""}`),
      skip: (s, why) => steps.push(`${s}: skipped — ${why}`),
      log: (l) => log.push(l),
    };
    const error = await runPipeline(handle, {
      upload: { filename: "paper.md", bytes: bytes(text), fields: {} },
      options: parseOptions(fields),
      fetchRemoteFigures: false,
      imageChain: [toolSvg()],
      run: async ({ outPath }) => {
        await writeFile(outPath, JSON.stringify(planWithABrief()));
      },
    }).then(
      () => undefined,
      (e: Error) => e,
    );
    return { dir, log, steps, error };
  }

  it("draws the plan's briefs, registers them as figures, and hands build the new objects", async () => {
    const out = await run({ images: "true" });
    expect(out.error?.message).toBe("STOP: reached build");
    expect(out.steps).toEqual([
      "ingest: begin",
      "ingest: done — 2 sections, 0 figures",
      "plan: begin",
      "plan: done — 1 beats",
      "illustrate: begin",
      "illustrate: done — 1 pictures via svg",
      "build: begin",
    ]);

    const storyboard = JSON.parse(await readFile(join(out.dir, "storyboard.json"), "utf8")) as {
      beats: { params: { figureId?: string; illustration?: unknown } }[];
    };
    const slot = storyboard.beats[0]?.params;
    expect(slot?.figureId).toBe("gen-b01");
    // The brief stays as provenance; a re-run finds the slot done and draws nothing.
    expect(slot?.illustration).toEqual({ prompt: "four gears in a ring", caption: "The loop" });

    const source = JSON.parse(await readFile(join(out.dir, "src", "source.json"), "utf8")) as {
      figures: { id: string; src: string; caption: string; width: number; height: number }[];
    };
    expect(source.figures).toHaveLength(1);
    const figure = source.figures[0];
    expect(figure).toMatchObject({ id: "gen-b01", caption: "The loop", width: 1536, height: 1024 });
    // Content-addressed in the file name, like every other asset under src/.
    expect(figure?.src).toMatch(/^gen-b01-[0-9a-f]{8}\.svg$/);
    const picture = await readFile(join(out.dir, "src", "assets", figure?.src ?? ""), "utf8");
    expect(picture.startsWith("<svg")).toBe(true);

    expect(out.log).toContainEqual(`illustrate: b01 → assets/${figure?.src} via svg`);
  });

  it("refuses a brief when illustrations are off, at plan, before anything is drawn", async () => {
    const out = await run({});
    expect(out.error?.message).toMatch(/b01.*with images off/s);
    expect(out.steps).not.toContain("illustrate: begin");
    expect(out.steps).not.toContain("build: begin");
  });
});

/* ------------------------------------------------------------------------ ui */

/**
 * THE GATE THAT WAS MISSING, and the reason it has to be a static one.
 *
 * `npm run build:server` transpiles src/server/*.ts file by file with NO
 * `--bundle`, so every import specifier survives verbatim into dist/server/.
 * The library, meanwhile, bundles to a single dist/index.js — there is no
 * dist/emit/ and no dist/types.js. src/server/ui.ts imported
 * `../emit/themes/index.js`, which exists in source and not in the build, so
 * `import("./ui.js")` in http.ts threw ERR_MODULE_NOT_FOUND on every request and
 * the server quietly served its 5 KB stand-in page instead of the real 58 KB
 * uploader. Every gate was green throughout: tsc resolves against SOURCE, these
 * tests import from source too, and `npm run serve` starts and answers 200.
 *
 * So asserting "uiPage() returns a page" would NOT have caught it — it passes in
 * both worlds. What distinguishes them is the specifier itself, which is why
 * this reads the text of the imports rather than executing them.
 */
describe("the server's imports survive the build", () => {
  const SERVER_DIR = new URL("../src/server/", import.meta.url);

  it("reaches the library only through ../index.js", async () => {
    const files = (await readdir(SERVER_DIR)).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(new URL(file, SERVER_DIR), "utf8");
      for (const m of text.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+"([^"]+)"/gm)) {
        const spec = m[1] as string;
        if (!spec.startsWith(".")) continue; // a package; node_modules is present in both trees
        // Siblings are emitted beside each other; ../index.js is the bundle.
        if (spec === "../index.js" || /^\.\/[^/]+\.js$/.test(spec)) continue;
        offenders.push(`${file} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("serves the real uploader, not the stand-in", () => {
    const html = uiPage();
    expect(html).toContain('id="compose"');
    // The format radios are built by script; the container is in the markup.
    expect(html).toContain('id="formats"');
    // The three switches `submit()` states outright, so an unticked box is a
    // "false" the server can read rather than an absence it cannot.
    for (const name of ["narrate", "video", "images"]) {
      expect(html).toContain(`id="${name}" name="${name}"`);
      expect(html).toContain(`fd.set("${name}"`);
    }
    // The stand-in is ~5 KB; the real page is ~59 KB. A page that fell back to
    // the stand-in would still be valid HTML and still answer 200.
    expect(html.length).toBeGreaterThan(20_000);
  });

  it("offers a page as well as a file, and never posts both", () => {
    const html = uiPage();
    expect(html).toContain('id="url" name="url"');
    /**
     * `submit()` HAS TO UNPICK THE BROWSER'S SERIALISATION HERE. Hiding `#pick`
     * does not take its fields out of the form, so a link typed and then a file
     * chosen would post the pair — which the server refuses, correctly, with a
     * 400 the person did nothing to deserve.
     */
    expect(html).toContain('fd.delete("url")');
    expect(html).toContain('fd.set("url", link)');
  });

  it("interpolates the canvas bounds it will enforce into the size inputs", () => {
    const html = uiPage();
    const canvas = catalog().canvas as Record<string, number>;
    // The number inputs must not offer a size the server refuses — 240..7680
    // against a server that took 320..2560 is what shipped.
    expect(html).toContain(`id="cw" name="width" min="${canvas.minSide}" max="${canvas.maxSide}"`);
    expect(html).toContain(`id="ch" name="height" min="${canvas.minSide}" max="${canvas.maxSide}"`);
    expect(html).toContain(`maxPixels: ${MAX_PIXELS}`);
    expect(html).toContain(`legibleWidth: ${LEGIBLE_W}`);
  });

  it("draws a tile for every format the server will accept", () => {
    const html = uiPage();
    for (const id of Object.keys(FORMATS)) expect(html).toContain(id);
  });
});

/**
 * Two things the page gets right that no runtime assertion here can see, because
 * both are only visible once a browser has laid the page out and a deck has
 * loaded inside it. Both shipped broken, both looked correct in the source.
 */
describe("the result viewer", () => {
  it("leaves room for the deck's own chrome instead of sizing to the ratio alone", () => {
    const html = uiPage();
    // aspect-ratio alone gives the player a stage 77px too short and it
    // pillarboxes: 714px of an 850px frame, 219px of a 356px one. The box has to
    // be ratio PLUS chrome, which aspect-ratio cannot express.
    expect(html).toContain("height:calc(100cqw / var(--arn");
    expect(html).toContain("var(--chrome, 0px)");
    // 100cqw needs a container, and .viewer is the frame.
    expect(html).toMatch(/\.viewer\{[^}]*container-type:inline-size/);
    // Measured off the loaded deck rather than hardcoded.
    expect(html).toContain("hyperframes-player");
  });

  it("converts the subtitles to WebVTT rather than handing a track element an .srt", () => {
    const html = uiPage();
    // `t.src = r.srtUrl` is the version that ships a captions button that never
    // appears: the track element parses WebVTT only, so an .srt lands in
    // readyState 3 with zero cues.
    expect(html).not.toMatch(/\.src\s*=\s*r\.srtUrl/);
    expect(html).toContain('"WEBVTT');
    expect(html).toContain('type: "text/vtt"');
  });
});
