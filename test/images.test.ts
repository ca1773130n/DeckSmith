/**
 * Pictures, without a network, a key or a Codex login.
 *
 * The backend adapter is pinned against the documented request and response
 * through an injected `fetch`; the Codex rung against an injected `Runner`
 * that leaves a real PNG behind; the tool rung against itself, because it is
 * pure. `illustrate` is driven with hand-written providers so every test here
 * finishes in milliseconds and none can ever spend money.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { illustrate } from "../src/images/illustrate.js";
import {
  codexImages,
  drawSvg,
  type ImageProvider,
  type ImageRequest,
  imageChain,
  openaiImages,
  resolveImageBackend,
  SIZE,
  svgSize,
  toolSvg,
} from "../src/images/providers.js";
import type { RunnerArgs } from "../src/plan/codex.js";
import { assertRefsResolve } from "../src/plan/refs.js";
import { prefsSchema, type Storyboard, sourceSchema, storyboardSchema } from "../src/types.js";

/* ---------------------------------------------------------------- Fixtures */

/** Signature and IHDR only — all `imageSize` reads, and all a fake needs to claim a size. */
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from("IHDR"),
    ihdr,
    Buffer.alloc(4),
  ]);
}

/** A complete 1×1 transparent PNG, CRCs and all — what an image tool actually writes. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const req: ImageRequest = {
  prompt: "a fox curled on a stack of books",
  style: "flat vector illustration",
  aspect: "landscape",
};

const dir = () => mkdtemp(join(tmpdir(), "ds-images-"));

/* ------------------------------------------------------------------ OpenAI */

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A `fetch` that records what it was asked and answers from `reply`. */
function fakeFetch(reply: (url: string, n: number) => Response) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return reply(url, calls.length);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("openaiImages", () => {
  it("posts the documented body with the key, and decodes b64_json", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, { data: [{ b64_json: png(1536, 1024).toString("base64") }] }),
    );
    const out = await openaiImages({ apiKey: "sk-test", fetch }).generate(req);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://api.openai.com/v1/images/generations");
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.headers).toEqual({
      authorization: "Bearer sk-test",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      model: "gpt-image-2",
      prompt:
        "a fox curled on a stack of books. flat vector illustration, landscape orientation (3:2), on a plain white background, no text.",
      n: 1,
      size: "1536x1024",
    });
    // The 120 s budget rides on the request as a signal; its length is not observable here.
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(out).toMatchObject({ mime: "image/png", width: 1536, height: 1024 });
    expect(out.bytes.equals(png(1536, 1024))).toBe(true);
  });

  it("sizes by aspect, trims a trailing period, and lets the request's model beat the configured one", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, { data: [{ b64_json: png(1, 1).toString("base64") }] }),
    );
    const provider = openaiImages({ apiKey: "k", model: "from-env", fetch });
    await provider.generate({ ...req, prompt: "a fox.", aspect: "square", model: "from-prefs" });
    await provider.generate({ ...req, aspect: "portrait" });
    expect(calls.map((c) => JSON.parse(String(c.init?.body)))).toEqual([
      expect.objectContaining({
        model: "from-prefs",
        size: "1024x1024",
        prompt:
          "a fox. flat vector illustration, square (1:1), on a plain white background, no text.",
      }),
      expect.objectContaining({ model: "from-env", size: "1024x1536" }),
    ]);
  });

  it("honours the base URL and follows a url on that origin, bare", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.endsWith("/images/generations")
        ? json(200, { data: [{ url: "http://127.0.0.1:8080/generated/1.png" }] })
        : new Response(new Uint8Array(png(1024, 1024))),
    );
    const out = await openaiImages({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:8080/v1/",
      fetch,
    }).generate({ ...req, aspect: "square" });

    expect(calls.map((c) => c.url)).toEqual([
      "http://127.0.0.1:8080/v1/images/generations",
      "http://127.0.0.1:8080/generated/1.png",
    ]);
    // The key travels once. The picture request carries no headers at all.
    expect(calls[1]?.init?.headers).toBeUndefined();
    expect(calls[1]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(out).toMatchObject({ mime: "image/png", width: 1024, height: 1024 });
  });

  it("refuses a url on any other origin, without repeating it", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, { data: [{ url: "https://oaidalle.blob.core.windows.net/private/1.png" }] }),
    );
    const err = await openaiImages({ apiKey: "k", fetch })
      .generate(req)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/not on the backend's origin/);
    expect((err as Error).message).not.toContain("blob.core");
    expect(calls).toHaveLength(1);
  });

  it("shapes an HTTP error from the status and the code, never the body", async () => {
    const at = (status: number, body: unknown) =>
      openaiImages({ apiKey: "k", fetch: fakeFetch(() => json(status, body)).fetch })
        .generate(req)
        .catch((e: Error) => e.message);

    expect(
      await at(401, {
        error: {
          message: "Incorrect API key provided: sk-secret-1234",
          code: "invalid_api_key",
          type: "invalid_request_error",
        },
      }),
    ).toBe("openai images: HTTP 401 (invalid_api_key)");
    // `type` stands in when there is no code; nothing stands in when there is neither.
    expect(await at(429, { error: { message: "quota", type: "insufficient_quota" } })).toBe(
      "openai images: HTTP 429 (insufficient_quota)",
    );
    expect(await at(502, "<html>Bad gateway at https://gw.internal/x</html>")).toBe(
      "openai images: HTTP 502",
    );
  });

  it("refuses an answer that is not a raster, and one with nothing in it", async () => {
    const svg = fakeFetch(() =>
      json(200, { data: [{ b64_json: Buffer.from("<svg/>").toString("base64") }] }),
    );
    await expect(openaiImages({ apiKey: "k", fetch: svg.fetch }).generate(req)).rejects.toThrow(
      /not a PNG or JPEG/,
    );
    const empty = fakeFetch(() => json(200, { data: [{}] }));
    await expect(openaiImages({ apiKey: "k", fetch: empty.fetch }).generate(req)).rejects.toThrow(
      /neither b64_json nor url/,
    );
  });

  it("stops reading an answer the moment it passes 16 MB", async () => {
    let pulled = 0;
    const { fetch } = fakeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled++;
              if (pulled > 64) controller.close();
              else controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
        ),
    );
    await expect(openaiImages({ apiKey: "k", fetch }).generate(req)).rejects.toThrow(/16 MB/);
    expect(pulled).toBeLessThan(32);
  });

  it("check() wants the key and nothing else", async () => {
    await expect(openaiImages({ apiKey: "" }).check()).rejects.toThrow(/DECKSMITH_IMAGES_API_KEY/);
    await expect(openaiImages({ apiKey: "k" }).check()).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------------- Codex */

describe("codexImages", () => {
  /** An account with the tool: leaves `picture` in the scratch dir and answers as told. */
  function account(answer: unknown, picture?: Buffer) {
    const seen: (RunnerArgs & { schema: unknown; cwdExisted: boolean })[] = [];
    const run = async (args: RunnerArgs) => {
      const cwd = args.cwd as string;
      seen.push({
        ...args,
        schema: JSON.parse(await readFile(args.schemaPath, "utf8")),
        cwdExisted: existsSync(cwd),
      });
      if (picture) await writeFile(join(cwd, "picture.png"), picture);
      if (answer !== undefined) await writeFile(args.outPath, JSON.stringify(answer));
    };
    return { run, seen };
  }

  it("runs codex fenced to a scratch directory, asks for one PNG, and reads it back", async () => {
    const { run, seen } = account({ ok: true, file: "picture.png", reason: null }, TINY_PNG);
    const out = await codexImages({ run }).generate(req);

    expect(out).toMatchObject({ mime: "image/png", width: 1, height: 1 });
    expect(out.bytes.equals(TINY_PNG)).toBe(true);

    const [args] = seen;
    expect(args?.sandbox).toBe("workspace-write");
    expect(basename(args?.cwd as string)).toMatch(/^decksmith-image-/);
    expect(args?.cwdExisted).toBe(true);
    expect(args?.timeoutMs).toBe(5 * 60_000);
    expect(args?.schemaPath.startsWith(args?.cwd as string)).toBe(true);
    expect(args?.outPath.startsWith(args?.cwd as string)).toBe(true);
    expect(args?.schema).toMatchObject({
      type: "object",
      required: ["ok", "file", "reason"],
      additionalProperties: false,
    });
    expect(args?.prompt).toContain("$imagegen");
    expect(args?.prompt).toContain("./picture.png");
    expect(args?.prompt).toContain(
      "a fox curled on a stack of books. flat vector illustration, landscape orientation (3:2), on a plain white background, no text.",
    );
    expect(args?.prompt).toMatch(/"ok": false/);
    // The scratch directory is gone, picture and all.
    expect(existsSync(args?.cwd as string)).toBe(false);
  });

  it("tells the agent to check its own picture for text and to refuse one that has it", async () => {
    const { run, seen } = account({ ok: true, file: "picture.png", reason: null }, TINY_PNG);
    await codexImages({ run }).generate(req);
    const prompt = seen[0]?.prompt ?? "";
    // The instruction that closes the gap nothing downstream can see: a raster's
    // text is invisible to the 40px floor, so the agent is the gate.
    expect(prompt).toContain("LOOK at ./picture.png");
    expect(prompt).toContain("words, numbers, labels, captions, watermarks or signage");
    expect(prompt).toContain("generate it once more with the");
    expect(prompt).toContain('"text in picture"');
  });

  it("lets a picture that keeps coming back with text fall through to the next rung", async () => {
    // What the agent answers when its second attempt still has words in it. The
    // rung fails, which is the point: `illustrate` moves on, and the tool's own
    // SVG has no text by construction.
    const { run } = account({ ok: false, file: null, reason: "text in picture" });
    await expect(codexImages({ run }).generate(req)).rejects.toThrow(
      "codex could not generate a picture: text in picture",
    );
  });

  it("reports the account's own reason when it has no image tool", async () => {
    const { run, seen } = account({
      ok: false,
      file: null,
      reason: "This account has no image generation tool.",
    });
    await expect(codexImages({ run }).generate(req)).rejects.toThrow(
      "codex could not generate a picture: This account has no image generation tool.",
    );
    expect(existsSync(seen[0]?.cwd as string)).toBe(false);
  });

  it("refuses an ok with no picture behind it, a non-raster, and no answer at all", async () => {
    const ok = { ok: true, file: "picture.png", reason: null };
    await expect(codexImages({ run: account(ok).run }).generate(req)).rejects.toThrow(
      /wrote no picture\.png/,
    );
    await expect(
      codexImages({ run: account(ok, Buffer.from("<svg/>")).run }).generate(req),
    ).rejects.toThrow(/not a PNG or JPEG/);
    await expect(codexImages({ run: account(undefined).run }).generate(req)).rejects.toThrow(
      /no final answer/,
    );
  });

  it("falls back to the file the agent named when picture.png is not there", async () => {
    const run = async (args: RunnerArgs) => {
      await writeFile(join(args.cwd as string, "fox.png"), TINY_PNG);
      await writeFile(args.outPath, JSON.stringify({ ok: true, file: "fox.png", reason: null }));
    };
    const out = await codexImages({ run }).generate(req);
    expect(out).toMatchObject({ mime: "image/png", width: 1, height: 1 });
  });
});

/* --------------------------------------------------------------------- SVG */

describe("toolSvg", () => {
  it("draws the same bytes for the same brief, and different ones for a different brief", async () => {
    const a = await toolSvg().generate(req);
    const b = await toolSvg().generate(req);
    expect(a.bytes.equals(b.bytes)).toBe(true);
    expect(a.mime).toBe("image/svg+xml");
    expect(drawSvg({ ...req, prompt: "a lighthouse" })).not.toBe(drawSvg(req));
    expect(drawSvg({ ...req, style: "woodcut" })).not.toBe(drawSvg(req));
    expect(drawSvg({ ...req, aspect: "square" })).not.toBe(drawSvg(req));
  });

  it("sizes the viewBox by aspect, in whole pixels, and can read it back", async () => {
    for (const aspect of ["landscape", "square", "portrait"] as const) {
      const out = await toolSvg().generate({ ...req, aspect });
      const { width, height } = SIZE[aspect];
      expect(out).toMatchObject({ width, height });
      expect(out.bytes.toString()).toContain(`viewBox="0 0 ${width} ${height}"`);
      expect(out.bytes.toString()).toContain(`width="${width}" height="${height}"`);
      expect(svgSize(out.bytes)).toEqual({ width, height });
    }
    expect(SIZE).toEqual({
      landscape: { width: 1536, height: 1024 },
      square: { width: 1024, height: 1024 },
      portrait: { width: 1024, height: 1536 },
    });
  });

  it("draws six to ten shapes and nothing that can be read, move, or reach out", () => {
    for (const prompt of ["a fox", "a lighthouse", "gears", "a river delta", "two chairs"]) {
      const svg = drawSvg({ ...req, prompt });
      for (const banned of ["<text", "<animate", "href", "<script", "<style", "url(", "<image"]) {
        expect(svg).not.toContain(banned);
      }
      const shapes = (svg.match(/<(circle|rect|line)\b/g) ?? []).length - 1; // minus the paper
      expect(shapes).toBeGreaterThanOrEqual(6);
      expect(shapes).toBeLessThanOrEqual(10);
      expect(svg).toContain('fill="#ffffff"');
    }
  });

  it("never fails check()", async () => {
    await expect(toolSvg().check()).resolves.toBeUndefined();
  });
});

/* -------------------------------------------------------------- Resolution */

const ids = (chain: ImageProvider[]) => chain.map((p) => p.id);
const images = (patch: Record<string, unknown>) => prefsSchema.parse({ images: patch }).images;
const backend = openaiImages({ apiKey: "k" });

describe("imageChain", () => {
  it("starts where the preference says, and always ends at the tool", () => {
    expect(ids(imageChain(images({ provider: "auto" }), backend))).toEqual([
      "openai",
      "codex",
      "svg",
    ]);
    expect(ids(imageChain(images({ provider: "auto" })))).toEqual(["codex", "svg"]);
    expect(ids(imageChain(images({ provider: "codex" }), backend))).toEqual(["codex", "svg"]);
    expect(ids(imageChain(images({ provider: "svg" }), backend))).toEqual(["svg"]);
  });
});

describe("resolveImageBackend", () => {
  const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

  it("is nothing when the environment names nothing", () => {
    expect(resolveImageBackend(env({}))).toBeUndefined();
    expect(resolveImageBackend(env({ DECKSMITH_IMAGES: "  " }))).toBeUndefined();
  });

  it("is the OpenAI adapter when named with a key", () => {
    const got = resolveImageBackend(
      env({ DECKSMITH_IMAGES: "openai", DECKSMITH_IMAGES_API_KEY: "sk-x" }),
    );
    expect(got?.id).toBe("openai");
  });

  it("refuses a name without a key, saying which variable to set", () => {
    expect(() => resolveImageBackend(env({ DECKSMITH_IMAGES: "openai" }))).toThrow(
      /DECKSMITH_IMAGES_API_KEY/,
    );
  });

  it("refuses a backend it does not have, naming it and what it accepts", () => {
    expect(() =>
      resolveImageBackend(env({ DECKSMITH_IMAGES: "gemini", DECKSMITH_IMAGES_API_KEY: "k" })),
    ).toThrow(/Unknown image backend "gemini".*openai/);
  });

  it("passes the base URL and model through to the adapter", async () => {
    // Observable only through the request the adapter makes; a bare fetch would
    // reach the network, so the adapter is rebuilt with the same env and a spy.
    const { fetch, calls } = fakeFetch(() =>
      json(200, { data: [{ b64_json: png(1, 1).toString("base64") }] }),
    );
    await openaiImages({
      apiKey: "k",
      baseUrl: "http://localhost:9/v1",
      model: "m",
      fetch,
    }).generate(req);
    expect(calls[0]?.url).toBe("http://localhost:9/v1/images/generations");
    expect(JSON.parse(String(calls[0]?.init?.body)).model).toBe("m");
  });
});

/* -------------------------------------------------------------- illustrate */

const source = sourceSchema.parse({
  id: "paper",
  title: "A paper",
  sections: [{ id: "sec-1", depth: 1, heading: "Intro", text: "Words." }],
  figures: [
    { id: "fig-real", src: "fig-real-abcd1234.png", caption: "Real", width: 800, height: 600 },
  ],
  equations: [],
  tables: [],
});

const brief = (scene: string) => ({ prompt: scene, caption: `A picture of ${scene}` });

const pending = storyboardSchema.parse({
  sourceId: "paper",
  title: "A paper",
  beats: [
    {
      id: "b1",
      intent: "i",
      archetype: "claim-figure",
      params: { headline: "H", claim: "C", illustration: brief("a lighthouse at dusk") },
    },
    {
      id: "b2",
      intent: "i",
      archetype: "split-compare",
      params: {
        headline: "H",
        left: { label: "Before", illustration: brief("a tangled ball of string") },
        right: { label: "After", illustration: brief("a neat coil of rope") },
      },
    },
    {
      id: "b3",
      intent: "i",
      archetype: "claim-figure",
      params: { headline: "H", claim: "C", figureId: "fig-real" },
    },
    {
      id: "b4",
      intent: "i",
      archetype: "split-compare",
      params: {
        headline: "H",
        left: { label: "L", lines: ["a list, not a picture"] },
        right: { label: "R", figureId: "fig-real" },
      },
    },
  ],
});

/** A provider that draws a header-only PNG at the aspect's size, or fails every time. */
function fake(id: string, fail?: string) {
  const calls: ImageRequest[] = [];
  const provider: ImageProvider = {
    id,
    async check() {},
    async generate(r) {
      calls.push(r);
      if (fail) throw new Error(fail);
      const { width, height } = SIZE[r.aspect];
      return { bytes: png(width, height), mime: "image/png", width, height };
    },
  };
  return { provider, calls };
}

const prefs = (patch: Record<string, unknown> = {}) =>
  prefsSchema.parse({ images: { enabled: true, ...patch } });

function figureIdOf(sb: Storyboard, id: string, side?: "left" | "right"): string | undefined {
  const beat = sb.beats.find((b) => b.id === id);
  if (beat?.archetype === "claim-figure") return beat.params.figureId;
  if (beat?.archetype === "split-compare" && side) return beat.params[side].figureId;
  return undefined;
}

describe("illustrate", () => {
  it("fills every pending slot, registers a sized figure for each, and keeps the brief", async () => {
    const assetsDir = await dir();
    const a = fake("a");
    const out = await illustrate(pending, source, {
      prefs: prefs(),
      assetsDir,
      chain: [a.provider],
    });

    // One request per slot, in beat order, at the slot's aspect, in the pref's style.
    expect(a.calls).toEqual([
      { prompt: "a lighthouse at dusk", style: "flat vector illustration", aspect: "landscape" },
      { prompt: "a tangled ball of string", style: "flat vector illustration", aspect: "square" },
      { prompt: "a neat coil of rope", style: "flat vector illustration", aspect: "square" },
    ]);

    expect(figureIdOf(out.storyboard, "b1")).toBe("gen-b1");
    expect(figureIdOf(out.storyboard, "b2", "left")).toBe("gen-b2-left");
    expect(figureIdOf(out.storyboard, "b2", "right")).toBe("gen-b2-right");

    const b1 = out.source.figures.find((f) => f.id === "gen-b1");
    expect(b1).toMatchObject({
      caption: "A picture of a lighthouse at dusk",
      width: 1536,
      height: 1024,
    });
    expect(b1?.src).toMatch(/^gen-b1-[0-9a-f]{8}\.png$/);
    expect(out.source.figures.find((f) => f.id === "gen-b2-left")).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(out.source.figures.map((f) => f.id)).toEqual([
      "fig-real",
      "gen-b1",
      "gen-b2-left",
      "gen-b2-right",
    ]);

    // The brief stays as provenance; the untouched beats are byte-for-byte the same.
    const drawn = out.storyboard.beats[0];
    expect(drawn?.archetype === "claim-figure" ? drawn.params.illustration : undefined).toEqual(
      brief("a lighthouse at dusk"),
    );
    expect(out.storyboard.beats[2]).toEqual(pending.beats[2]);
    expect(out.storyboard.beats[3]).toEqual(pending.beats[3]);

    // Files on disk, no temp left behind, and the figures now resolve for `build`.
    expect((await readdir(assetsDir)).sort()).toEqual(
      out.source.figures
        .slice(1)
        .map((f) => f.src)
        .sort(),
    );
    expect(() => assertRefsResolve(out.storyboard, out.source)).not.toThrow();

    expect(out.illustrated).toEqual([
      { beatId: "b1", figureId: "gen-b1", provider: "a", src: b1?.src, cached: false },
      expect.objectContaining({ beatId: "b2", figureId: "gen-b2-left", provider: "a" }),
      expect.objectContaining({ beatId: "b2", figureId: "gen-b2-right", provider: "a" }),
    ]);

    // The inputs were not touched.
    expect(figureIdOf(pending, "b1")).toBeUndefined();
    expect(source.figures).toHaveLength(1);
  });

  it("is idempotent: a second run finds every slot done and asks no provider", async () => {
    const assetsDir = await dir();
    const first = await illustrate(pending, source, {
      prefs: prefs(),
      assetsDir,
      chain: [fake("a").provider],
    });
    const again = fake("a");
    const second = await illustrate(first.storyboard, first.source, {
      prefs: prefs(),
      assetsDir,
      chain: [again.provider],
    });
    expect(again.calls).toEqual([]);
    expect(second.illustrated).toEqual([]);
    expect(second.storyboard).toEqual(first.storyboard);
    expect(second.source).toEqual(first.source);
  });

  it("reuses a picture already on disk without asking the provider again", async () => {
    const assetsDir = await dir();
    const first = await illustrate(pending, source, {
      prefs: prefs(),
      assetsDir,
      chain: [fake("a").provider],
    });
    // The same pending storyboard again — re-planned, source lost, whatever — with
    // the same rung id: the name is a hash of what produced it, so the file is found.
    const again = fake("a");
    const second = await illustrate(pending, source, {
      prefs: prefs(),
      assetsDir,
      chain: [again.provider],
    });
    expect(again.calls).toEqual([]);
    expect(second.illustrated.map((i) => i.cached)).toEqual([true, true, true]);
    expect(second.source.figures).toEqual(first.source.figures);
  });

  it("names the file by what produced it, so a changed style is a new picture", async () => {
    const assetsDir = await dir();
    const flat = await illustrate(pending, source, {
      prefs: prefs(),
      assetsDir,
      chain: [fake("a").provider],
    });
    const cut = await illustrate(pending, source, {
      prefs: prefs({ style: "woodcut" }),
      assetsDir,
      chain: [fake("a").provider],
    });
    const src = (o: typeof flat) => o.source.figures.find((f) => f.id === "gen-b1")?.src;
    expect(src(flat)).not.toBe(src(cut));
    expect(await readdir(assetsDir)).toHaveLength(6);
  });

  it("drops a rung after its first failure, says so once, and carries on down", async () => {
    const assetsDir = await dir();
    const a = fake("a", "boom");
    const b = fake("b");
    const steps: string[] = [];
    const out = await illustrate(pending, source, {
      prefs: prefs(),
      assetsDir,
      chain: [a.provider, b.provider],
      onStep: (m) => steps.push(m),
    });
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(3);
    expect(steps).toEqual(["illustrate: b1 via a failed (boom); trying b"]);
    expect(out.illustrated.map((i) => i.provider)).toEqual(["b", "b", "b"]);
  });

  it("spends the chain on the first images.max pictures and has the tool draw the rest", async () => {
    const assetsDir = await dir();
    const a = fake("a");
    const steps: string[] = [];
    const out = await illustrate(pending, source, {
      prefs: prefs({ max: 1 }),
      assetsDir,
      chain: [a.provider],
      onStep: (m) => steps.push(m),
    });
    expect(a.calls).toHaveLength(1);
    expect(out.illustrated.map((i) => i.provider)).toEqual(["a", "svg", "svg"]);
    expect(out.source.figures.find((f) => f.id === "gen-b2-left")).toMatchObject({
      width: 1024,
      height: 1024,
    });
    expect(out.source.figures.find((f) => f.id === "gen-b2-left")?.src).toMatch(/\.svg$/);
    expect(steps).toEqual([
      "illustrate: b2 left is past images.max (1), so the tool draws it",
      "illustrate: b2 right is past images.max (1), so the tool draws it",
    ]);

    // Zero means every picture by the tool, and no provider is ever asked.
    const none = fake("a");
    const all = await illustrate(pending, source, {
      prefs: prefs({ max: 0 }),
      assetsDir: await dir(),
      chain: [none.provider],
    });
    expect(none.calls).toEqual([]);
    expect(all.illustrated.map((i) => i.provider)).toEqual(["svg", "svg", "svg"]);
  });

  it("always finishes: when every rung fails, the tool draws every picture", async () => {
    const assetsDir = await dir();
    const steps: string[] = [];
    const out = await illustrate(pending, source, {
      prefs: prefs(),
      assetsDir,
      chain: [fake("a", "down").provider, fake("b", "no image tool").provider],
      onStep: (m) => steps.push(m),
    });
    expect(steps).toEqual([
      "illustrate: b1 via a failed (down); trying b",
      "illustrate: b1 via b failed (no image tool); trying svg",
    ]);
    expect(out.illustrated.map((i) => i.provider)).toEqual(["svg", "svg", "svg"]);
    expect(out.source.figures.slice(1).every((f) => f.src.endsWith(".svg"))).toBe(true);
    expect(() => assertRefsResolve(out.storyboard, out.source)).not.toThrow();
    // A cached SVG is measured from its own viewBox on the next run.
    const again = await illustrate(pending, source, { prefs: prefs(), assetsDir, chain: [] });
    expect(again.illustrated.map((i) => i.cached)).toEqual([true, true, true]);
    expect(again.source.figures).toEqual(out.source.figures);
  });

  it("creates the assets directory when it is missing", async () => {
    const assetsDir = join(await dir(), "nested", "assets");
    const out = await illustrate(pending, source, {
      prefs: prefs({ provider: "svg" }),
      assetsDir,
      chain: [fake("a").provider],
    });
    expect(await readdir(assetsDir)).toHaveLength(3);
    expect(out.illustrated).toHaveLength(3);
  });

  it("regenerates a slot whose figure the source has lost, replacing a stale figure of the same id", async () => {
    // A re-planned storyboard arrives pending while the old source still lists
    // `gen-b1` from the last run. One `gen-b1` afterwards, not two.
    const stale = sourceSchema.parse({
      ...source,
      figures: [
        ...source.figures,
        { id: "gen-b1", src: "gen-b1-00000000.png", caption: "old", width: 10, height: 10 },
      ],
    });
    const out = await illustrate(pending, stale, {
      prefs: prefs(),
      assetsDir: await dir(),
      chain: [fake("a").provider],
    });
    const mine = out.source.figures.filter((f) => f.id === "gen-b1");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ width: 1536, height: 1024 });
  });
});
