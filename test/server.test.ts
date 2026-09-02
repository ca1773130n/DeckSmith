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
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { toolSvg } from "../src/images/providers.js";
import { FORMATS, LEGIBLE_W, MAX_ASPECT, MIN_EDGE, parseMarkdown } from "../src/index.js";
import { explain } from "../src/server/errors.js";
import { createDeckServer, parseRange, RateLimiter, safeUrlPath } from "../src/server/http.js";
import { catalog, MAX_PIXELS, parseOptions } from "../src/server/options.js";
import { stagesFor } from "../src/server/pipeline.js";
import { type JobHandle, type JobResult, Queue, QueueFullError } from "../src/server/queue.js";
import { uiPage } from "../src/server/ui.js";
import {
  looksLikeZip,
  parseMultipart,
  pickMarkdown,
  readBody,
  readZip,
  safeEntryPath,
  UploadError,
} from "../src/server/upload.js";

const bytes = (s: string) => new TextEncoder().encode(s);
const scratch = async () => mkdtemp(join(tmpdir(), "decksmith-server-"));

/* ------------------------------------------------------------------ multipart */

/** A multipart body built by hand, so the parser is tested and not a client. */
function multipart(
  parts: { name: string; value: string; filename?: string; type?: string }[],
  boundary = "----DeckSmithTest",
): { body: Buffer; contentType: string } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    const type = part.filename ? `\r\nContent-Type: ${part.type ?? "text/markdown"}` : "";
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

describe("multipart", () => {
  it("reads the file part and the scalar fields", async () => {
    const { body, contentType } = multipart([
      { name: "file", value: "# Title\n\nSome prose.\n", filename: "a paper.md" },
      { name: "format", value: "short-9x16" },
      { name: "slides", value: "7" },
    ]);
    const upload = await parseMultipart(body, contentType);
    expect(upload.filename).toBe("a paper.md");
    expect(new TextDecoder().decode(upload.bytes)).toBe("# Title\n\nSome prose.\n");
    expect(upload.fields).toEqual({ format: "short-9x16", slides: "7" });
  });

  it("keeps UTF-8 intact", async () => {
    const { body, contentType } = multipart([
      { name: "file", value: "# 한글 제목\n\néé\n", filename: "ko.md" },
    ]);
    const upload = await parseMultipart(body, contentType);
    expect(new TextDecoder().decode(upload.bytes)).toContain("한글 제목");
  });

  it("names the missing part rather than throwing a TypeError", async () => {
    const { body, contentType } = multipart([{ name: "format", value: "deck-16x9" }]);
    await expect(parseMultipart(body, contentType)).rejects.toThrow(/no "file" part/);
  });

  it("refuses a body that is not multipart", async () => {
    await expect(parseMultipart(Buffer.from("{}"), "application/json")).rejects.toThrow(
      /takes a multipart/,
    );
  });

  it("says so when the file part is empty", async () => {
    const { body, contentType } = multipart([{ name: "file", value: "", filename: "empty.md" }]);
    await expect(parseMultipart(body, contentType)).rejects.toThrow(/is empty/);
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
    // Provider, style and model are the deployment's, never the form's.
    expect(on.prefs.images.provider).toBe("auto");
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
});

/* ------------------------------------------------------------------- the routes */

describe("the HTTP surface", () => {
  const shut: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of shut.splice(0)) await close();
  });

  async function serve(over: Partial<Parameters<typeof createDeckServer>[0]> = {}) {
    const work = await scratch();
    const { server, queue } = createDeckServer({
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
      log: () => {},
      // Writes the deck a real pipeline would write, without being one.
      run: async (job) => {
        const { mkdir, writeFile: write } = await import("node:fs/promises");
        await mkdir(join(job.dir, "deck", "assets"), { recursive: true });
        await write(join(job.dir, "deck", "deck.html"), "<h1>deck</h1>");
        await write(join(job.dir, "deck", "assets", "fig1.png"), "PNGDATA");
        job.begin("ingest");
        job.done("ingest");
        return { deckUrl: `/d/${job.id}/deck.html`, slides: 4, duration: 12, warnings: [] };
      },
      ...over,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    shut.push(() => new Promise<void>((r) => server.close(() => r())));
    return { base, queue, work };
  }

  interface Posted {
    status: number;
    id: string;
    error?: { message: string; hint: string };
  }

  async function post(base: string, parts: Parameters<typeof multipart>[0]): Promise<Posted> {
    const { body, contentType } = multipart(parts);
    const res = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": contentType },
      // `BodyInit` does not name Node's Buffer; the view is over the same bytes.
      body: new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength),
    });
    const json = (await res.json()) as { id?: string; error?: Posted["error"] };
    return { status: res.status, id: json.id ?? "", ...(json.error ? { error: json.error } : {}) };
  }

  async function settle(base: string, id: string) {
    for (let i = 0; i < 200; i++) {
      const view = (await (await fetch(`${base}/api/jobs/${id}`)).json()) as { state: string };
      if (view.state === "done" || view.state === "error") return view;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("job never settled");
  }

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
    expect(deck.headers.get("x-content-type-options")).toBe("nosniff");
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
    expect(bad.error?.message).toMatch(/no "file" part/);
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
