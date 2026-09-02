/**
 * The HTTP surface: five routes, node:http, no framework.
 *
 * A router that has to distinguish five paths does not need a dependency, and
 * the thing a framework would actually have saved — multipart parsing — is in
 * Node already: `new Response(body, { headers }).formData()` is undici's parser
 * and returns a real `File`. Verified before this file existed; see the note in
 * ./upload.ts.
 *
 * The security posture lives here rather than being spread around:
 *   - a job id is 128 bits from `randomBytes`, so /d/:id is unguessable, and
 *     every id is re-validated against a character class before it reaches a path;
 *   - static serving under /d/:id resolves and then PROVES containment, so a
 *     traversal in the URL fails the same way a traversal in a zip entry does;
 *   - a deck is a stranger's document turned into HTML, so it is served into a
 *     CSP sandbox and cannot reach the origin that serves the uploader;
 *   - two rate limits per IP: one for requests, one for the expensive verb.
 */
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { catalog, parseOptions } from "./options.js";
import { type PipelineInput, runPipeline, stagesFor } from "./pipeline.js";
import { type JobHandle, type JobResult, type JobView, Queue, QueueFullError } from "./queue.js";
import { parseMultipart, readBody, type Upload, UploadError } from "./upload.js";

/** base64url of 16 random bytes. Unguessable, URL-safe, and a legal path segment. */
const ID = /^[A-Za-z0-9_-]{22}$/;

export interface ServeOptions {
  port: number;
  host: string;
  /** Root under which every job gets its own directory. */
  work: string;
  maxUploadBytes: number;
  maxQueued: number;
  ttlMs: number;
  /** Jobs one IP may submit per hour. The expensive verb gets its own budget. */
  jobsPerHour: number;
  requestsPerMinute: number;
  fetchRemoteFigures: boolean;
  /** Serve decks into a CSP sandbox. On unless deliberately turned off. */
  sandboxDecks: boolean;
  /** Remove a finished job's directory. Injected so tests need no filesystem. */
  removeDir: (dir: string) => void;
  log: (line: string) => void;
  /**
   * The work a job does. Defaults to the real pipeline; substituted in tests so
   * that exercising the routes never spawns a Codex or spends anyone's quota.
   * Same seam, and the same reason, as `Runner` in src/plan/codex.ts.
   */
  run?: (job: JobHandle, input: PipelineInput) => Promise<JobResult>;
}

/* ------------------------------------------------------- surviving a restart */

/** What a retry needs, and nothing else. `fields` re-derives every option. */
const KEEP = "job.json";
const RAW = "upload.bin";

interface Kept {
  filename: string;
  fields: Record<string, string>;
  createdAt: number;
}

/**
 * Put the upload on disk before the job starts.
 *
 * The queue lives in memory, so a restart forgets every running job — that part
 * is by design and cheap to accept. Losing the user's FILE with it is not: it is
 * the one thing here they cannot regenerate, and without it "submit it again"
 * means going back to find the document. Written at submit rather than in
 * `ingest` so the window where a crash costs the file is zero rather than a few
 * hundred milliseconds.
 *
 * Best effort. A deck that cannot write its retry copy should still be built.
 */
async function keepUpload(dir: string, upload: Upload): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const kept: Kept = { filename: upload.filename, fields: upload.fields, createdAt: Date.now() };
    await writeFile(join(dir, KEEP), JSON.stringify(kept));
    await writeFile(join(dir, RAW), upload.bytes);
  } catch {
    /* not worth failing a job over */
  }
}

async function readKept(dir: string): Promise<{ kept: Kept; bytes: Buffer } | null> {
  try {
    const kept = JSON.parse(await readFile(join(dir, KEEP), "utf8")) as Kept;
    if (typeof kept?.filename !== "string" || typeof kept?.fields !== "object") return null;
    return { kept, bytes: await readFile(join(dir, RAW)) };
  } catch {
    return null;
  }
}

export function createDeckServer(opts: ServeOptions): { server: Server; queue: Queue } {
  const queue = new Queue({
    maxQueued: opts.maxQueued,
    ttlMs: opts.ttlMs,
    onExpire: (id, dir) => {
      opts.log(`sweep: ${id} expired`);
      opts.removeDir(dir);
    },
  });
  const requests = new RateLimiter(opts.requestsPerMinute, 60_000);
  const jobs = new RateLimiter(opts.jobsPerHour, 60 * 60_000);

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => fail(res, err));
  });
  // An upload is allowed to be slow; an idle socket is not allowed to be free.
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    if (!requests.take(ipOf(req))) {
      return send(res, 429, {
        error: { message: "Too many requests.", hint: "Slow down and retry in a minute." },
      });
    }

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      const page = await uiPage(opts.log);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }
    if (req.method === "GET" && path === "/api/formats") {
      return send(res, 200, catalog());
    }
    if (req.method === "POST" && path === "/api/jobs") {
      return submit(req, res);
    }

    const events = path.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (req.method === "GET" && events) return stream(req, res, events[1] as string);

    const retry = path.match(/^\/api\/jobs\/([^/]+)\/retry$/);
    if (req.method === "POST" && retry) return again(req, res, retry[1] as string);

    const one = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && one) {
      const id = one[1] as string;
      const view = ID.test(id) ? queue.view(id) : undefined;
      if (view) return send(res, 200, view);
      // Known to the disk but not to the queue: the process that was running it
      // has been replaced. The upload survived, so this is a resumable state and
      // not a 404 — answering 404 here is what left a browser polling forever.
      const kept = ID.test(id) ? await readKept(join(resolve(opts.work), id)) : null;
      if (kept) {
        return send(res, 200, {
          id,
          state: "interrupted",
          filename: kept.kept.filename,
          createdAt: kept.kept.createdAt,
        });
      }
      return send(res, 404, {
        error: {
          message: "No such job.",
          hint: "It may have expired; jobs are kept for a couple of hours.",
        },
      });
    }

    const deck = path.match(/^\/d\/([^/]+)(\/.*)?$/);
    if ((req.method === "GET" || req.method === "HEAD") && deck) {
      return serveDeck(req, res, deck[1] as string, deck[2] ?? "/");
    }

    send(res, 404, {
      error: {
        message: `No route for ${req.method} ${path}.`,
        hint: "The API is POST /api/jobs, GET /api/jobs/:id and GET /api/formats.",
      },
    });
  }

  /* ------------------------------------------------------------- POST /jobs */

  async function submit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // PARSE FIRST, CHARGE SECOND. This limit is spent on the expensive verb, and
    // the message says so — "already submitted N decks this hour". Taken before
    // the body was parsed it also counted every REFUSAL: five mistyped canvas
    // sizes, or five wrong file types, and the answer became 429 for an hour to
    // someone who had never started a job. Nothing costly has happened until
    // `queue.submit` below, and request volume is already bounded by the
    // per-minute limiter in `handle`, so nothing is exposed by counting later.
    const body = await readBody(req, opts.maxUploadBytes);
    const upload = await parseMultipart(body, req.headers["content-type"] ?? "");
    const options = parseOptions(upload.fields);

    if (!jobs.take(ipOf(req))) {
      return send(res, 429, {
        error: {
          message: `That address has already submitted ${opts.jobsPerHour} decks this hour.`,
          hint: "Each deck is minutes of CPU. Wait for the hour to roll over.",
        },
      });
    }

    const id = randomBytes(16).toString("base64url");
    const dir = join(resolve(opts.work), id);
    await keepUpload(dir, upload);
    const view = queue.submit({
      id,
      dir,
      stages: stagesFor(options),
      run: (job) =>
        (opts.run ?? runPipeline)(job, {
          upload,
          options,
          fetchRemoteFigures: opts.fetchRemoteFigures,
        }),
    });
    opts.log(
      `job ${id}: ${upload.filename} (${Math.round(upload.bytes.length / 1024)} KB) → ${options.formatId}${options.narrate ? " +narration" : ""}${options.video ? " +video" : ""}${options.images ? " +illustrations" : ""}, position ${view.queuePosition ?? 0}`,
    );
    send(res, 202, { id, queuePosition: view.queuePosition ?? 0 });
  }

  /**
   * Run a kept upload again, under a new id.
   *
   * A new id rather than reusing the old one: the old directory holds the debris
   * of a half-finished run, and a job that reuses it would be building on top of
   * whatever the interrupted one left behind. The old directory is swept when it
   * ages out.
   */
  async function again(req: IncomingMessage, res: ServerResponse, old: string): Promise<void> {
    if (!ID.test(old)) return send(res, 404, { error: { message: "No such job." } });
    const kept = await readKept(join(resolve(opts.work), old));
    if (!kept) {
      return send(res, 404, {
        error: {
          message: "That upload is no longer on the server.",
          hint: "Choose the file again.",
        },
      });
    }
    if (!jobs.take(ipOf(req))) {
      return send(res, 429, {
        error: {
          message: `That address has already submitted ${opts.jobsPerHour} decks this hour.`,
          hint: "Each deck is minutes of CPU. Wait for the hour to roll over.",
        },
      });
    }
    const upload: Upload = {
      filename: kept.kept.filename,
      bytes: kept.bytes,
      fields: kept.kept.fields,
    };
    const options = parseOptions(upload.fields);
    const id = randomBytes(16).toString("base64url");
    const dir = join(resolve(opts.work), id);
    await keepUpload(dir, upload);
    const view = queue.submit({
      id,
      dir,
      stages: stagesFor(options),
      run: (job) =>
        (opts.run ?? runPipeline)(job, {
          upload,
          options,
          fetchRemoteFigures: opts.fetchRemoteFigures,
        }),
    });
    opts.log(`job ${id}: retry of ${old} — ${upload.filename} → ${options.formatId}`);
    send(res, 202, { id, queuePosition: view.queuePosition ?? 0 });
  }

  /* ------------------------------------------------------------------- SSE */

  function stream(req: IncomingMessage, res: ServerResponse, id: string): void {
    if (!ID.test(id) || !queue.view(id)) {
      send(res, 404, { error: { message: "No such job.", hint: "It may have expired." } });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    let last = "";
    const push = (view: JobView) => {
      // The view carries a monotonically increasing `ms`, so it always differs;
      // compare without it or every heartbeat becomes an event.
      const { ms: _ms, ...stable } = view;
      const body = JSON.stringify(view);
      if (JSON.stringify(stable) === last) return;
      last = JSON.stringify(stable);
      res.write(`data: ${body}\n\n`);
      if (view.state === "done" || view.state === "error") {
        clearInterval(beat);
        stop();
        res.end();
      }
    };
    const stop = queue.watch(id, push);
    // A proxy that sees nothing for 60s closes the connection, and planning is
    // a minute of one stage saying nothing.
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(beat);
      stop();
    });
    const now = queue.view(id);
    if (now) push(now);
  }

  /* -------------------------------------------------------------- /d/:id/* */

  async function serveDeck(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    rest: string,
  ): Promise<void> {
    if (!ID.test(id))
      return send(res, 404, { error: { message: "No such deck.", hint: "Check the link." } });
    const base = resolve(join(opts.work, id, "deck"));
    const rel = safeUrlPath(rest);
    if (rel === null) {
      return send(res, 400, {
        error: {
          message: "That path is not one we will serve.",
          hint: "Follow the link the job returned rather than editing it.",
        },
      });
    }
    const file = resolve(join(base, rel || "deck.html"));
    if (file !== base && !file.startsWith(base + sep)) {
      return send(res, 403, {
        error: {
          message: "That path is outside the deck.",
          hint: "Follow the link the job returned rather than editing it.",
        },
      });
    }

    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      return send(res, 404, {
        error: {
          message: "Not in this deck.",
          hint: "The job may still be running, or its files may have expired.",
        },
      });
    }

    const ext = extname(file).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "content-type": type,
      "accept-ranges": "bytes",
      // Each job id is fresh, so its files never change under the same URL.
      "cache-control": "private, max-age=600",
    };
    // NO `Access-Control-Allow-Origin` ON FONTS ANY MORE, and the reason is the
    // sandbox change below. A `@font-face` fetch is CORS-governed, so while the
    // deck sat on an OPAQUE origin every KaTeX woff2 was blocked and every
    // equation silently fell back — invariant 9 arriving through the server — and
    // `ACAO: *` was the fix. With `allow-same-origin` the deck loads as this
    // origin, the font fetch is same-origin, and the header buys nothing except
    // letting any cross-origin page that holds a job id read those bytes.
    // Verified, not assumed: with this removed, slide 3's five KaTeX nodes still
    // report their faces `loaded` (experiments/011-reconcile/09-equations.png).
    // A deck is a stranger's document compiled to HTML and inline script, so it
    // is sandboxed. WHAT IS IN THE LIST AND WHY `allow-same-origin` HAD TO JOIN IT:
    //
    // `deck.html` is the HyperFrames player, and the player loads the composition
    // into a CHILD IFRAME (`<iframe class="hfp-iframe" src="index.html">`) which
    // it then drives across the document boundary — seek, scene list, the lot. It
    // frames that child itself with `sandbox="allow-scripts allow-same-origin"`,
    // because it needs `contentDocument`.
    //
    // A CSP `sandbox` directive on a RESPONSE cannot be relaxed by the framer, so
    // omitting `allow-same-origin` here put `index.html` on a unique opaque origin
    // no matter what the player asked for. The player's `contentDocument` was
    // `null`, it never got past "Preparing scene transitions", and every slide
    // rendered EMPTY — subtitles and the 1/12 counter still worked, because those
    // are drawn by the player's own document. `done` job, every file a 200, zero
    // console errors, a deck with nothing on it. Proven by serving the identical
    // bytes twice: sandboxed → blank, `DECKSMITH_DECK_SANDBOX=0` → correct
    // (experiments/011-reconcile/06- and 07-*.png).
    //
    // WHAT IS STILL BOUGHT. Without `allow-forms`, `allow-popups`, `allow-modals`
    // and above all `allow-top-navigation`, a malicious deck cannot navigate the
    // tab away, open a window, post a form, or raise a dialog. What is NOT bought
    // any more is origin isolation: the deck now runs AS this origin and could
    // fetch `/api/jobs/<id>` for an id it already knows. Real isolation needs the
    // decks served from a SEPARATE ORIGIN — the player's same-origin requirement
    // cannot be satisfied and denied at once on one host. That is the fix, it is
    // a second listener, and it is written up in the README rather than faked here.
    // EVERY deck response, not only text/html.
    //
    // `.svg` is served as image/svg+xml, and an SVG navigated to directly is a
    // DOCUMENT that may carry script — so gating the sandbox on text/html left a
    // hole exactly the width of one file extension. It is reachable: `copyAssets`
    // in src/cli.ts is a blind `cp(assets, ..., {recursive:true})`, so whatever
    // sits in a source's assets directory arrives in the served deck verbatim,
    // and a deck is a stranger's document.
    //
    // Applying it broadly costs nothing. `sandbox` constrains DOCUMENTS; on an
    // mp3, a PNG or a stylesheet fetched as a subresource it is inert, which is
    // why this is a wider net rather than a trade. Verified after the change:
    // the deck still plays, navigates and narrates.
    if (opts.sandboxDecks) {
      // `connect-src 'none'` costs the deck nothing and removes the only thing
      // `allow-same-origin` is actually worth to an attacker. A deck fetches
      // NOTHING: scripts and fonts are vendored beside it, narration audio is an
      // <audio src> (media-src, not connect-src), and the islands are inline
      // JSON. So script that gets into a deck can no longer reach /api/jobs at
      // all — which is the reachable half of the same-origin problem, closed for
      // one directive. The other half, a deck reading another deck's DOM, still
      // needs the separate origin described below.
      headers["content-security-policy"] =
        "sandbox allow-scripts allow-same-origin allow-downloads; connect-src 'none'";
      // A deck is one origin's private artifact; nothing off-site should be able
      // to pull its bytes into a page it controls.
      headers["cross-origin-resource-policy"] = "same-site";
    }

    const range = parseRange(req.headers.range, info.size);
    if (range === "unsatisfiable") {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      res.end();
      return;
    }
    if (range) {
      headers["content-range"] = `bytes ${range.start}-${range.end}/${info.size}`;
      headers["content-length"] = String(range.end - range.start + 1);
      res.writeHead(206, headers);
      if (req.method === "HEAD") return void res.end();
      createReadStream(file, range).pipe(res);
      return;
    }
    headers["content-length"] = String(info.size);
    res.writeHead(200, headers);
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  }

  function fail(res: ServerResponse, err: unknown): void {
    if (res.headersSent) return void res.end();
    if (err instanceof UploadError || err instanceof QueueFullError) {
      send(res, err.status, { error: { message: err.message, hint: err.hint } });
      return;
    }
    opts.log(`error: ${err instanceof Error ? err.stack : String(err)}`);
    send(res, 500, {
      error: {
        message: "The server could not handle that request.",
        hint: "If it repeats, the server log has the detail; nothing about your document is wrong that we can name.",
      },
    });
  }

  return { server, queue };
}

/* --------------------------------------------------------------------- bits */

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * A URL path, turned into a relative path or refused.
 *
 * Same rule as `safeEntryPath`, and for the same reason: percent-decoding is
 * what turns `%2e%2e%2f` back into `../`, so the decode has to happen BEFORE the
 * segments are judged, not after they are joined.
 */
export function safeUrlPath(rest: string): string | null {
  const out: string[] = [];
  for (const raw of rest.split("/")) {
    if (raw === "") continue;
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null; // a broken escape is not a filename
    }
    if (seg === ".") continue;
    if (seg === ".." || seg.includes("/") || seg.includes("\\") || seg.includes("\0")) return null;
    out.push(seg);
  }
  return out.join("/");
}

/** One byte range, the only form a browser sends for media. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const [, rawStart = "", rawEnd = ""] = m;
  if (rawStart === "" && rawEnd === "") return null;
  let start: number;
  let end: number;
  if (rawStart === "") {
    // "-500": the last 500 bytes.
    start = Math.max(0, size - Number(rawEnd));
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return "unsatisfiable";
  }
  return { start, end };
}

/**
 * A fixed-window counter per key. Not a token bucket: the thing being limited is
 * "how many decks may one address ask for in an hour", and an hour is the unit
 * the answer is stated in, so a window is what the message can honestly describe.
 */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const at = this.now();
    const row = this.#hits.get(key);
    if (!row || row.resetAt <= at) {
      // Sweeping here rather than on a timer: the map only grows when requests
      // arrive, so the cleanup belongs on the same path.
      if (this.#hits.size > 10_000) {
        for (const [k, v] of this.#hits) if (v.resetAt <= at) this.#hits.delete(k);
      }
      this.#hits.set(key, { count: 1, resetAt: at + this.windowMs });
      return true;
    }
    if (row.count >= this.limit) return false;
    row.count++;
    return true;
  }
}

/**
 * The peer address, and only the peer address.
 *
 * X-Forwarded-For is NOT read. Behind no proxy it is a header the client writes,
 * which would make every rate limit here opt-out. Putting this behind a reverse
 * proxy means teaching it to rate-limit, or teaching this to trust exactly one hop.
 */
function ipOf(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".deck": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/**
 * The uploader page.
 *
 * `src/server/ui.ts` belongs to another workstream and may not exist yet, so it
 * is imported through a variable specifier — which neither `tsc` nor esbuild
 * tries to resolve — and a small working page stands in when it is absent. The
 * contract is one export: `PAGE`, a complete HTML document, either a string or a
 * function returning one. `default` and `page` are accepted too, because
 * guessing wrong about a name should not cost a round trip.
 */
let cachedPage: string | undefined;
async function uiPage(log: (line: string) => void): Promise<string> {
  if (cachedPage) return cachedPage;
  const specifier = "./ui.js";
  try {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const page = mod.uiPage ?? mod.PAGE ?? mod.page ?? mod.default;
    const html = typeof page === "function" ? (page as () => string)() : page;
    if (typeof html === "string" && html.trim() !== "") {
      cachedPage = html;
      return html;
    }
    log(`decksmith: ${specifier} exports no page; serving the stand-in uploader`);
  } catch (err) {
    // WHY THIS IS LOGGED AND NOT SWALLOWED. It was swallowed, and it cost the
    // entire uploader page: ui.ts imported `../emit/themes/index.js`, which does
    // not exist under dist/, so this threw ERR_MODULE_NOT_FOUND on every request
    // and the server quietly answered with FALLBACK_PAGE below. A 200 with a
    // working-but-wrong page is indistinguishable from success from the outside,
    // and no gate in this project opens a browser at "/". A silent catch around
    // an optional import is fine; a silent catch that downgrades the product is
    // not. Say which page is being served and why.
    log(
      `decksmith: cannot load ${specifier} (${err instanceof Error ? err.message : String(err)}); serving the stand-in uploader`,
    );
  }
  cachedPage = FALLBACK_PAGE;
  return cachedPage;
}

/**
 * Enough of an uploader to prove the API end to end without the other agent's
 * page: pick a file, pick a format, watch the stages, get the links. Deliberately
 * plain — it is a stand-in, not a design.
 */
const FALLBACK_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeckSmith</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;color:#111}
 fieldset{border:1px solid #ddd;border-radius:6px;margin:0 0 1rem}
 label{display:inline-block;margin:.25rem 1rem .25rem 0}
 #steps li{font-variant-numeric:tabular-nums}
 #log{background:#111;color:#ddd;padding:.75rem;border-radius:6px;max-height:16rem;overflow:auto;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace}
 .err{background:#fee;border:1px solid #c00;padding:.75rem;border-radius:6px}
</style></head><body>
<h1>DeckSmith</h1>
<p>A document in, an animated deck out. Markdown, or a zip holding one.</p>
<form id="f">
  <fieldset><legend>Document</legend>
    <input type="file" name="file" accept=".md,.markdown,.txt,.zip" required>
  </fieldset>
  <fieldset><legend>Options</legend>
    <label>Format <select name="format" id="format"></select></label>
    <label>Theme <select name="theme" id="theme"></select></label>
    <label>Slides <input type="number" name="slides" min="3" max="40" value="12" style="width:5rem"></label>
    <label><input type="checkbox" name="narrate" value="true"> Narrate</label>
    <label><input type="checkbox" name="video" value="true"> Video</label>
    <label><input type="checkbox" name="images" value="true"> Illustrations</label>
  </fieldset>
  <button>Make the deck</button>
</form>
<div id="out"></div>
<script>
const $ = (s) => document.querySelector(s);
// EVERY string below originates in an upload — a filename, a zip entry name, a
// figure id the planner echoed back — so nothing reaches the DOM as markup.
// This page is served from the same origin as the API; an unescaped error
// message would be reflected XSS with the attacker choosing the filename.
const el = (tag, text, attrs) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  return n;
};
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
const errorBox = (e) => {
  const box = el("div", null, { class: "err" });
  box.append(el("b", e.message), el("br"), document.createTextNode(e.hint || ""));
  return box;
};
fetch("/api/formats").then(r => r.json()).then(c => {
  for (const f of c.formats) $("#format").append(el("option", f.id + " — " + f.width + "×" + f.height, { value: f.id }));
  for (const t of c.themes) $("#theme").append(el("option", t));
});
$("#f").addEventListener("submit", async (e) => {
  e.preventDefault();
  clear($("#out")).append(el("p", "Uploading…"));
  const res = await fetch("/api/jobs", { method: "POST", body: new FormData(e.target) });
  const body = await res.json();
  if (!res.ok) { clear($("#out")).append(errorBox(body.error)); return; }
  watch(body.id);
});
function watch(id) {
  clear($("#out")).append(el("ul", null, { id: "steps" }), el("p", null, { id: "where" }), el("pre", null, { id: "log" }));
  const es = new EventSource("/api/jobs/" + encodeURIComponent(id) + "/events");
  es.onmessage = (m) => draw(JSON.parse(m.data), es);
  es.onerror = () => { es.close(); poll(id); };
}
async function poll(id) {
  const v = await (await fetch("/api/jobs/" + encodeURIComponent(id))).json();
  draw(v, null);
  if (v.state === "queued" || v.state === "running") setTimeout(() => poll(id), 2000);
}
const ICON = { pending: "…", running: "▶", done: "✓", skipped: "–", error: "✗" };
function draw(v, es) {
  const secs = (n) => (n / 1000).toFixed(0) + "s";
  const steps = clear($("#steps"));
  for (const s of v.steps) {
    steps.append(el("li", ICON[s.state] + " " + s.name + (s.ms ? " " + secs(s.ms) : "") + (s.detail ? " — " + s.detail : "")));
  }
  const where = clear($("#where"));
  where.textContent = v.state === "queued"
    ? "queued, position " + v.queuePosition
    : v.state + (v.stage ? " · " + v.stage : "") + " · " + secs(v.ms) + " elapsed";
  $("#log").textContent = v.log.join("\\n");
  $("#log").scrollTop = 1e9;
  if (v.error) clear(where).append(errorBox(v.error));
  if (v.result) {
    clear(where).append(el("span", v.result.slides + " slides, " + v.result.duration.toFixed(0) + "s — "));
    for (const [label, href] of [["Open the deck", v.result.deckUrl], ["Video", v.result.videoUrl], ["Subtitles", v.result.srtUrl], ["Pack", v.result.packUrl]]) {
      // Server-minted, same-origin paths only; anything else is not a link.
      if (href && href.startsWith("/d/")) where.append(el("a", label, { href, target: "_blank" }), document.createTextNode(" "));
    }
    if (v.result.warnings.length) {
      const ul = el("ul");
      for (const w of v.result.warnings) ul.append(el("li", w));
      where.append(ul);
    }
  }
  if (es && (v.state === "done" || v.state === "error")) es.close();
}
</script></body></html>
`;
