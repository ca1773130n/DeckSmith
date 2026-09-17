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
 *     CSP sandbox with `connect-src 'none'`; everything that is NOT a deck is
 *     unframeable, so a deck cannot borrow a same-origin realm that has no such
 *     rule (`BASELINE_CSP`). That does not stop a deck shown inside the uploader
 *     reaching its parent — see the README's "What is missing";
 *   - three rate limits per IP: requests, the expensive verb, and failed tokens;
 *   - a write another site's page makes a browser send is refused, and so is any
 *     request by a name the server does not answer to (`foreignRequest`);
 *   - with a token file configured, every route but the deck files, the player
 *     module and the way in needs the token or a session made from it
 *     (`credential`, ./auth.ts). Unknown routes are private too, so a route added
 *     later starts out behind the gate.
 */
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createTlsServer, type Server as TlsServer } from "node:https";
import { isIP } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AuthKeys,
  bearerOf,
  clearedCookie,
  cookieName,
  cookieValues,
  LOOPBACK_BINDS,
  mintSession,
  sessionCookie,
  sessionValid,
  type TlsMaterial,
  tokenMatches,
} from "./auth.js";
import { catalog, parseOptions } from "./options.js";
import { type PipelineInput, runPipeline, stagesFor } from "./pipeline.js";
import { type JobHandle, type JobResult, type JobView, Queue, QueueFullError } from "./queue.js";
import { parseSubmission, readBody, type Submission, UploadError } from "./upload.js";

/** base64url of 16 random bytes. Unguessable, URL-safe, and a legal path segment. */
const ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * What a served deck may put in a frame: itself, and the video players.
 *
 * COPIED FROM `EMBED_ORIGINS` IN src/pack/media.ts RATHER THAN IMPORTED, and the
 * BUILD is what says so. This directory is transpiled file by file with no
 * bundling, so every import specifier survives verbatim into dist/server/ — and
 * `../pack/media.js` exists in source and not in the build, which is
 * ERR_MODULE_NOT_FOUND on the next request with every gate green. That failure
 * has already happened here once, over `../emit/themes/index.js`; the gate that
 * now stops it is "the server's imports survive the build" in
 * test/server.test.ts, and the library reaches this directory only through
 * ../index.js, which does not carry this constant.
 *
 * So the two lists are pinned equal by a test in the same suite instead: it
 * imports `EMBED_ORIGINS` from source and asserts this directive names exactly
 * `'self'` and those origins. Adding a host to the embed table and forgetting it
 * here fails that test rather than a viewer's deck.
 */
const FRAME_SRC = [
  "'self'",
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.dailymotion.com",
  "https://www.loom.com",
].join(" ");

/**
 * Every response that is not a deck file: unframeable, and a document with no
 * rights if it is ever navigated to. Set first thing in `handle`, so the 401s,
 * 403s, 413s, 429s and 500s get it, and so do /d/'s own 400/403/404 and 416.
 *
 * WHY EVERY ONE AND NOT ONLY THE PAGES. A deck is served with `connect-src
 * 'none'`, but `frame-src 'self'` — the player needs it — let it frame any other
 * same-origin response and call that frame's `contentWindow.fetch`, which runs
 * under the FRAME's policy: a JSON 404 from /d/ carried none, so a deck opened
 * top-level could POST /api/jobs through it. `frame-ancestors 'none'` and
 * `X-Frame-Options` refuse the frame; `sandbox` makes the document opaque even
 * if something does load it.
 */
const BASELINE_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";
/** The uploader and embed.html: their own scripts and frames, but nobody frames them. */
const PAGE_CSP = "frame-ancestors 'none'; form-action 'self'; base-uri 'none'";
/** The login page runs no script, loads nothing, and posts only to itself. */
const LOGIN_CSP = `default-src 'none'; style-src 'unsafe-inline'; ${PAGE_CSP}`;

/** Every 401 says the same thing, so a 401 tells a prober nothing about a route. */
const UNAUTHORIZED = JSON.stringify({
  error: {
    message: "This server needs its token.",
    hint: "In a browser, open / and log in. From a script, send Authorization: Bearer <token>.",
  },
});

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
  /**
   * Require the token. Built from DECKSMITH_TOKEN_FILE by `resolveSecurity` in
   * ./auth.ts; absent, the server behaves as it did before tokens existed.
   */
  auth?: AuthKeys;
  /**
   * Serve https. On a bind that is not loopback the certificate's SANs are the
   * names the server answers to.
   */
  tls?: TlsMaterial;
  /** The clock sessions and the failed-token limiter read. Injected by tests. */
  now?: () => number;
  /**
   * TEST SEAM ONLY. `false` drops the anti-framing headers every non-deck
   * response carries, so the browser test can show what they stop. Nothing in
   * src/ passes it.
   */
  frameHeaders?: boolean;
}

/* ------------------------------------------------------- surviving a restart */

/** What a retry needs, and nothing else. `fields` re-derives every option. */
const KEEP = "job.json";
const RAW = "upload.bin";

interface Kept {
  /**
   * The file's name, or the URL when the job was submitted as one. It is a
   * LABEL — what the interrupted-job view shows the person who came back — and
   * `url` below, not this, is what says which kind of job it was.
   */
  filename: string;
  fields: Record<string, string>;
  createdAt: number;
  /** Set for a URL job, and then there is no `upload.bin` beside this file. */
  url?: string;
}

/**
 * Put the submission on disk before the job starts.
 *
 * The queue lives in memory, so a restart forgets every running job — that part
 * is by design and cheap to accept. Losing the user's FILE with it is not: it is
 * the one thing here they cannot regenerate, and without it "submit it again"
 * means going back to find the document. Written at submit rather than in
 * `ingest` so the window where a crash costs the file is zero rather than a few
 * hundred milliseconds.
 *
 * A URL job keeps the same shape for the same reason, minus the bytes: the URL
 * IS the document as far as a retry is concerned, and re-harvesting it is what
 * running it again means. So `/api/jobs/:id` reports it as `interrupted` and
 * `/retry` resumes it exactly as it resumes an upload — no second code path, and
 * no kind of job that answers 404 to a browser that is still polling.
 *
 * Best effort. A deck that cannot write its retry copy should still be built.
 */
async function keepSubmission(dir: string, sub: Submission): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const kept: Kept =
      sub.kind === "url"
        ? { filename: sub.url, fields: sub.fields, createdAt: Date.now(), url: sub.url }
        : { filename: sub.upload.filename, fields: sub.fields, createdAt: Date.now() };
    await writeFile(join(dir, KEEP), JSON.stringify(kept));
    if (sub.kind === "file") await writeFile(join(dir, RAW), sub.upload.bytes);
  } catch {
    /* not worth failing a job over */
  }
}

/**
 * The kept job, rebuilt into the same `Submission` the parser would have made.
 *
 * Returning the submission rather than the raw pieces is what keeps `again()`
 * from re-deciding which kind of job this was: the shape that decision was
 * recorded in is the shape it comes back as.
 */
async function readKept(dir: string): Promise<{ kept: Kept; again: Submission } | null> {
  try {
    const kept = JSON.parse(await readFile(join(dir, KEEP), "utf8")) as Kept;
    if (typeof kept?.filename !== "string" || typeof kept?.fields !== "object") return null;
    if (typeof kept.url === "string") {
      return { kept, again: { kind: "url", url: kept.url, fields: kept.fields } };
    }
    const bytes = await readFile(join(dir, RAW));
    return {
      kept,
      again: {
        kind: "file",
        upload: { filename: kept.filename, bytes, fields: kept.fields },
        fields: kept.fields,
      },
    };
  } catch {
    return null;
  }
}

/**
 * The half of `PipelineInput` that says where the document comes from.
 *
 * One function so `submit` and `again` cannot drift on it — the retry path
 * having quietly become upload-only is exactly the bug this shape prevents.
 */
function sourceOf(sub: Submission): Pick<PipelineInput, "upload" | "url"> {
  return sub.kind === "url" ? { url: sub.url } : { upload: sub.upload };
}

export function createDeckServer(opts: ServeOptions): {
  server: Server | TlsServer;
  queue: Queue;
} {
  const loopback = LOOPBACK_BINDS.includes(opts.host);
  // THE SECOND GUARD. `resolveSecurity` refuses these at startup; this is for
  // the caller that never went through it.
  if (!loopback && !(opts.auth && opts.tls)) {
    throw new Error(
      `createDeckServer: ${JSON.stringify(opts.host)} is not a loopback bind, and a server reachable from a network needs both \`auth\` and \`tls\`. See resolveSecurity in src/server/auth.ts.`,
    );
  }
  if (!opts.sandboxDecks && (opts.auth || !loopback)) {
    throw new Error(
      "createDeckServer: `sandboxDecks: false` is allowed only on a loopback bind without `auth` — without the deck CSP a deck can use the viewer's session.",
    );
  }
  const now = opts.now ?? Date.now;
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
  // Charged only by a token that was compared and did not match. A missing
  // credential or an expired cookie costs nothing: neither is a guess.
  const failures = new RateLimiter(10, 15 * 60_000, now);
  const tls = opts.tls;
  const cookie = cookieName(tls !== undefined);
  const site: Site = {
    loopback,
    scheme: tls ? "https" : "http",
    allowHost: (name) => {
      if (!tls) return false;
      const bare = name.replace(/^\[(.*)\]$/, "$1");
      // `checkIP` throws on anything that is not an address, so ask it only about addresses.
      return (
        tls.x509.checkHost(name, { subject: "never" }) !== undefined ||
        (isIP(bare) !== 0 && tls.x509.checkIP(bare) !== undefined)
      );
    },
    names: tls?.x509.subjectAltName ?? "",
  };

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err: unknown) => fail(res, err));
  };
  // No plain-http listener beside it and no redirect: a second port that
  // answers is a second port to get wrong.
  const server = tls
    ? createTlsServer(
        { cert: tls.cert, key: tls.key, minVersion: "TLSv1.2", handshakeTimeout: 10_000 },
        handler,
      )
    : createServer(handler);
  // An upload is allowed to be slow; an idle socket is not allowed to be free.
  // Assigned for https too: its defaults are 300s and 60s, not these.
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Headers BEFORE anything that can throw: `new URL` below throws on a
    // request line like `GET http://[`, and that 500 is a response too.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (opts.frameHeaders !== false) {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Content-Security-Policy", BASELINE_CSP);
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (!requests.take(ipOf(req))) {
      return send(res, 429, {
        error: { message: "Too many requests.", hint: "Slow down and retry in a minute." },
      });
    }

    // BEFORE THE AUTH GATE: a wrong Host never learns whether it would have
    // needed a token, and a cross-site write is 403 with or without one.
    const refused = foreignRequest(req, site);
    if (refused) {
      opts.log(`refused: ${req.method} ${path} — ${refused.message}`);
      return send(res, 403, { error: refused });
    }

    const read = req.method === "GET" || req.method === "HEAD";
    if (opts.auth) {
      if (req.method === "POST" && path === "/login") return login(req, res, opts.auth);
      if (req.method === "POST" && path === "/logout") {
        res.writeHead(303, {
          location: "/",
          "set-cookie": clearedCookie(cookie, tls !== undefined),
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      // Checked before any body is read, and before routing.
      const pub =
        (read && /^\/d\/[^/]+(\/.*)?$/.test(path)) ||
        (req.method === "GET" && (path === "/player.js" || path === "/" || path === "/index.html"));
      if (!pub) {
        const who = credential(req, path, opts.auth);
        if (who === "blocked") return tooManyFailures(req, res);
        if (who === "none" || who === "wrong") return unauthorized(req, res);
        // A browser attaches a cookie to whatever it is told to send. A write
        // that rides on one must carry the headers `foreignRequest` judged, or
        // there was nothing to judge. A bearer cannot be attached cross-site
        // without a preflight, and this server answers none.
        if (
          who === "cookie" &&
          !read &&
          req.headers["sec-fetch-site"] === undefined &&
          req.headers.origin === undefined
        ) {
          opts.log(
            `refused: ${req.method} ${path} — cookie write without Sec-Fetch-Site or Origin`,
          );
          res.setHeader("connection", "close");
          return send(res, 403, {
            error: {
              message:
                "Refused a write that carried a session cookie but no Sec-Fetch-Site or Origin.",
              hint: "A browser sends one of them. A script should send Authorization: Bearer <token> instead of a cookie.",
            },
          });
        }
      }
    }

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      if (opts.auth) {
        res.setHeader("cache-control", "no-store");
        res.setHeader("vary", "Cookie");
        const who = credential(req, path, opts.auth);
        if (who === "blocked") return tooManyFailures(req, res);
        if (who === "wrong") return unauthorized(req, res);
        if (who === "none") return loginPage(res, 200, "");
      }
      const page = await uiPage(opts.log, opts.auth !== undefined);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...policy(PAGE_CSP) });
      res.end(page);
      return;
    }
    if (req.method === "GET" && path === "/api/formats") {
      return send(res, 200, catalog());
    }
    // The player module, served from our own dist beside this file — the same
    // `import.meta.url` shape src/server/main.ts and src/cli.ts already use to
    // reach dist/ from dist/server/. Served rather than inlined so the page's
    // <script type="module"> and a third party's import are the same artifact.
    if (req.method === "GET" && path === "/player.js") {
      const file = fileURLToPath(new URL("../deck-player-element.js", import.meta.url));
      return readFile(file).then(
        (js) => {
          res.writeHead(200, {
            "content-type": "text/javascript; charset=utf-8",
            // A build artifact whose name never changes, so it must not be
            // cached across a version bump.
            "cache-control": "no-cache",
          });
          res.end(js);
        },
        () =>
          send(res, 500, {
            error: {
              message: "The player module is missing from this install.",
              hint: 'Run "npm run build" — dist/deck-player-element.js is produced by scripts/build.mjs.',
            },
          }),
      );
    }
    // The embedding example, beside the module it demonstrates. Served from
    // dist/ for the same reason /player.js is: what a reader opens here and
    // what they copy into their own app are one file, so the demo cannot drift
    // from the documentation. It takes deck URLs from its own form or query
    // string — job ids are unguessable by design, so there is no fixed deck
    // URL to bake in, and no listing endpoint that could hand out someone
    // else's.
    //
    // BEHIND THE TOKEN, unlike /player.js. It is a same-origin page that frames
    // whatever deck its query string names as soon as it opens, so a link to it
    // is a way to put a chosen deck next to the viewer's session.
    if (req.method === "GET" && path === "/examples/embed.html") {
      const file = fileURLToPath(new URL("../embed.html", import.meta.url));
      return readFile(file).then(
        (html) => {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
            ...policy(PAGE_CSP),
          });
          res.end(html);
        },
        () =>
          send(res, 500, {
            error: {
              message: "The embedding example is missing from this install.",
              hint: 'Run "npm run build" — dist/embed.html is copied by scripts/build.mjs.',
            },
          }),
      );
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
      // has been replaced. The submission survived — the file's bytes, or the URL
      // to fetch again — so this is a resumable state and not a 404. Answering
      // 404 here is what left a browser polling forever.
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
    //
    // WHAT BOUNDS A URL JOB, since `maxUploadBytes` does not. It bounds this
    // REQUEST — a `url` field is sixty bytes and never comes near it — and
    // nothing more, because the bytes a URL job spends are fetched later, from a
    // server this one does not control. `HARVEST_LIMITS` in ./pipeline.ts is the
    // limit that stands in its place, and it states the bound in all three units
    // this one does not reach: bytes, request count and wall time.
    const body = await readBody(req, opts.maxUploadBytes);
    const sub = await parseSubmission(body, req.headers["content-type"] ?? "");
    const options = parseOptions(sub.fields);

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
    await keepSubmission(dir, sub);
    const view = queue.submit({
      id,
      dir,
      stages: stagesFor(options),
      run: (job) =>
        (opts.run ?? runPipeline)(job, {
          ...sourceOf(sub),
          options,
          fetchRemoteFigures: opts.fetchRemoteFigures,
        }),
    });
    const what =
      sub.kind === "url"
        ? sub.url
        : `${sub.upload.filename} (${Math.round(sub.upload.bytes.length / 1024)} KB)`;
    opts.log(
      `job ${id}: ${what} → ${options.formatId}${options.narrate ? " +narration" : ""}${options.video ? " +video" : ""}${options.images ? " +illustrations" : ""}, position ${view.queuePosition ?? 0}`,
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
          message: "That job is no longer on the server.",
          hint: "Choose the file again, or paste the address again.",
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
    const sub = kept.again;
    const options = parseOptions(sub.fields);
    const id = randomBytes(16).toString("base64url");
    const dir = join(resolve(opts.work), id);
    await keepSubmission(dir, sub);
    const view = queue.submit({
      id,
      dir,
      stages: stagesFor(options),
      run: (job) =>
        (opts.run ?? runPipeline)(job, {
          ...sourceOf(sub),
          options,
          fetchRemoteFigures: opts.fetchRemoteFigures,
        }),
    });
    opts.log(`job ${id}: retry of ${old} — ${kept.kept.filename} → ${options.formatId}`);
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
      // `connect-src 'none'` costs the deck nothing and removes the most direct
      // thing `allow-same-origin` is worth to an attacker. A deck fetches
      // NOTHING: scripts and fonts are vendored beside it, narration audio is an
      // <audio src> (media-src, not connect-src), and the islands are inline
      // JSON. So script that gets into a deck cannot call /api/jobs from its own
      // realm — and, because every non-deck response is unframeable
      // (`BASELINE_CSP`), not by framing some other same-origin page and using
      // that frame's `fetch` either.
      //
      // WHAT IT DOES NOT CLOSE, and this used to say it did. A deck shown INSIDE
      // the uploader is same-origin with its parent, so `parent.fetch` runs under
      // the uploader's policy, which has no `connect-src` — measured, see
      // .planning/2026-09-18-deck-parent-reach.md. With a token configured that
      // request carries the viewer's session. `SameSite=Strict` and a private
      // embed.html stop another site steering someone into that; the real fix
      // is serving /d/ from a separate origin, and so is the other half, a deck
      // reading another deck's DOM.
      //
      // `frame-src 'self'`, AND IT MUST NOT BE `'none'`. The intent is the one
      // `'none'` sounds like — a deck may not frame a third party, whatever an
      // emitter or an uploaded SVG managed to put in it — but `deck.html` IS a
      // framing document: the HyperFrames player builds `<iframe
      // src="index.html">` at runtime and drives it through `contentDocument`,
      // which is the whole reason `allow-same-origin` is in the sandbox list
      // above. `frame-src 'none'` blocks that child, and the failure it produces
      // is the one already measured and written up two paragraphs up — every
      // slide blank, the job `done`, every file a 200, the console empty. So the
      // directive is `'self'`: same-origin composition allowed, and every
      // off-site origin refused, which is the half worth refusing.
      //
      // PLUS THE PLAYER ORIGINS, AND NOTHING ELSE — `FRAME_SRC` above. A clip
      // whose bytes we could not fetch is a poster in the composition; in the
      // PRESENTED deck the runtime opens the real player in a frame, on the
      // viewer's click (src/deck/runtime.ts). That frame needs its origin named
      // here. Not `*`, not a bare `https:`: either would re-open exactly the
      // hole `'self'` was closing, since a deck is a stranger's document and an
      // uploaded SVG is a document too.
      //
      // WHAT THE SANDBOX DOES TO THAT NESTED FRAME, because a sandboxed frame
      // that cannot load its child is the silent failure this project keeps
      // finding. Sandbox flags are inherited by nested browsing contexts, so the
      // player runs with exactly `allow-scripts allow-same-origin
      // allow-downloads`. Scripts run and it keeps its OWN origin — cross-origin
      // to the deck, so `allow-same-origin` grants it nothing here — which is
      // what playback needs. MEASURED, on a served deck driven with Chrome
      // 145 headless: the YouTube embed loads, paints its poster and its
      // controls, and is pixel-identical to the same frame served with no CSP
      // at all; an origin the directive does not name is refused outright
      // ("Framing 'https://example.com/' violates ... frame-src"). What stays
      // withheld bites only the embed's chrome: with no `allow-popups` and no
      // `allow-top-navigation`, clicking its "watch on YouTube" pill opened no
      // tab and moved the deck nowhere. `connect-src 'none'` does NOT reach
      // inside the player — CSP is not inherited across an origin, only the
      // sandbox flags are — so the player's own XHRs are its business.
      // Fullscreen is a permissions-policy feature
      // rather than a sandbox token, and the runtime asks for it on the frame's
      // `allow` attribute.
      headers["content-security-policy"] =
        `sandbox allow-scripts allow-same-origin allow-downloads; connect-src 'none'; frame-src ${FRAME_SRC}`;
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
    // THE BASELINE COMES OFF HERE AND NOWHERE ELSE. `handle` made this response
    // unframeable; a deck is the one thing this server serves that is MEANT to
    // be framed — by the uploader, by embed.html, by a third party's page — so a
    // successful deck response (200, 206, HEAD) drops `X-Frame-Options` and
    // replaces the baseline CSP with its own. Every error from this route above,
    // the 416 included, keeps the baseline.
    res.removeHeader("X-Frame-Options");
    if (!opts.sandboxDecks) res.removeHeader("Content-Security-Policy");
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

  /* ------------------------------------------------------------ the token */

  /** A page's own CSP, unless the test seam has taken the framing headers off. */
  function policy(csp: string): Record<string, string> {
    return opts.frameHeaders === false ? {} : { "content-security-policy": csp };
  }

  /**
   * What this request presents.
   *
   * AN `Authorization` HEADER IS THE ONLY CREDENTIAL WHEN IT IS THERE. A wrong
   * bearer beside a valid cookie is a wrong bearer: a script that sends both is
   * confused, and the answer it needs is 401, not whatever the browser's cookie
   * would have allowed. Anything but `Bearer <token>` is `wrong` without being a
   * guess, so it is neither charged nor logged.
   */
  function credential(
    req: IncomingMessage,
    path: string,
    auth: AuthKeys,
  ): "bearer" | "cookie" | "none" | "wrong" | "blocked" {
    const header = req.headers.authorization;
    if (header !== undefined) {
      const token = bearerOf(header);
      if (token === null) return "wrong";
      const ip = ipOf(req);
      if (failures.blocked(ip)) return "blocked";
      if (tokenMatches(auth, token)) return "bearer";
      failures.take(ip);
      opts.log(`auth: wrong bearer on ${req.method} ${path} from ${ip}`);
      return "wrong";
    }
    const at = now();
    return cookieValues(req.headers.cookie, cookie).some((v) => sessionValid(auth, v, at))
      ? "cookie"
      : "none";
  }

  /** `Connection: close` on a refusal that may have a body behind it: none of it is read. */
  function closing(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "GET" && req.method !== "HEAD") res.setHeader("connection", "close");
  }

  function unauthorized(req: IncomingMessage, res: ServerResponse): void {
    closing(req, res);
    res.writeHead(401, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(UNAUTHORIZED),
      "www-authenticate": 'Bearer realm="decksmith"',
      "cache-control": "no-store",
    });
    res.end(UNAUTHORIZED);
  }

  function tooManyFailures(req: IncomingMessage, res: ServerResponse): void {
    closing(req, res);
    send(res, 429, {
      error: {
        message: "Too many wrong tokens from this address.",
        hint: "Wait fifteen minutes. A correct token is refused too until then.",
      },
    });
  }

  /**
   * POST /login: the token from the page's form, a session cookie back.
   *
   * 303 to `/` and nothing else — no return-to parameter, so there is no
   * redirect here for another site to aim. A failure re-renders the page with a
   * fixed sentence and never what was typed.
   */
  async function login(req: IncomingMessage, res: ServerResponse, auth: AuthKeys): Promise<void> {
    const ip = ipOf(req);
    res.setHeader("cache-control", "no-store");
    if (failures.blocked(ip)) {
      closing(req, res);
      return loginPage(
        res,
        429,
        "Too many wrong tokens from this address. Wait fifteen minutes and try again.",
      );
    }
    let body: Buffer;
    try {
      body = await readBody(req, 4096);
    } catch (err) {
      if (err instanceof UploadError && err.status === 413) {
        return loginPage(res, 413, "That was too large to be a login.");
      }
      throw err;
    }
    const token = new URLSearchParams(body.toString("utf8")).get("token") ?? "";
    if (tokenMatches(auth, token)) {
      res.writeHead(303, {
        location: "/",
        "set-cookie": sessionCookie(cookie, mintSession(auth, now()), tls !== undefined),
      });
      res.end();
      return;
    }
    failures.take(ip);
    opts.log(`login: refused from ${ip}`);
    res.setHeader("www-authenticate", 'Bearer realm="decksmith"');
    return loginPage(res, 401, "That is not this server's token.");
  }

  function loginPage(res: ServerResponse, status: number, message: string): void {
    const html = LOGIN_PAGE.replace(
      "<!--message-->",
      message ? `<p class="err" role="alert">${message}</p>` : "",
    );
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
      "cache-control": "no-store",
      ...policy(LOGIN_CSP),
    });
    res.end(html);
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

  /**
   * Whether `take` would refuse, without spending anything. The failed-token
   * limiter asks this BEFORE comparing, so an exhausted budget refuses a correct
   * token too and the comparison stops being an oracle; it `take`s only after a
   * comparison fails.
   */
  blocked(key: string): boolean {
    const row = this.#hits.get(key);
    return row !== undefined && row.resetAt > this.now() && row.count >= this.limit;
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

/** The names a browser can reach a loopback bind by, as `URL.hostname` spells them. */
const LOOPBACK_NAMES = ["127.0.0.1", "[::1]", "localhost"];

/** What `foreignRequest` needs to know about how this server is reached. */
interface Site {
  loopback: boolean;
  /** On a bind that is not loopback: whether the certificate names `name`. */
  allowHost: (name: string) => boolean;
  scheme: "http" | "https";
  /** The certificate's SANs, for the refusal's hint. */
  names: string;
}

/**
 * Why a browser on some other site sent this, or null if nothing says it did.
 *
 * DNS REBINDING FIRST, on every method and every bind. A page at evil.example
 * that re-resolves its own name to this server is same-origin to itself, so
 * every header below reads clean, and it can read the answers too. The name it
 * used cannot be forged: `Host` still says evil.example. On loopback the names
 * are the loopback names. On any other bind they are the certificate's SANs —
 * a bind that is not loopback cannot start without one — so the server answers
 * to exactly the names a browser would accept its certificate for, and there
 * is no second list to disagree with it.
 *
 * CSRF SECOND, on anything that is not a read. A multipart POST is CORS-simple,
 * so any site can make its visitor's browser send one, and CORS only stops that
 * site reading the reply. `Sec-Fetch-Site` says where it came from; `Origin` is
 * the fallback for a browser without fetch metadata, compared against this
 * server's own scheme — over TLS a browser writes `https://`, and comparing
 * against `http://` refused every one of them. `same-site` is refused too: a
 * different port on localhost is the same site. A request carrying neither
 * header is not from a browser, and curl is not a confused deputy — though a
 * write authorised by a session COOKIE must carry one; see `handle`.
 *
 * `Origin: null` IS REFUSED, AND THIS SERVER'S OWN PAGE SENDS IT. Measured in
 * the renderer's Chrome: the uploader's no-script `<form>` posts `Origin: null`,
 * because `Referrer-Policy: no-referrer` below nulls it on a form navigation,
 * and passes only because `Sec-Fetch-Site: same-origin` is read first. Its
 * `fetch` sends the real origin. So the one client this costs is a browser old
 * enough to lack fetch metadata AND running without script — and `null` is
 * also what a sandboxed frame on any site sends.
 */
function foreignRequest(
  req: IncomingMessage,
  site: Site,
): { message: string; hint: string } | null {
  const host = req.headers.host ?? "";
  let name = "";
  try {
    name = new URL(`http://${host}`).hostname;
  } catch {
    // An unparseable Host names nothing this server answers to; refused below.
  }
  const known =
    name !== "" && (site.loopback ? LOOPBACK_NAMES.includes(name) : site.allowHost(name));
  if (!known) {
    return {
      message: `Refused a request addressed to "${host}".`,
      hint: site.loopback
        ? "This server is bound to loopback and answers only to 127.0.0.1, localhost or [::1]. Open it by one of those names."
        : `This server answers only to the names its certificate lists: ${site.names}. Open it by one of those.`,
    };
  }
  if (req.method === "GET" || req.method === "HEAD") return null;
  const fetchSite = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  const foreign =
    fetchSite !== undefined
      ? fetchSite !== "same-origin" && fetchSite !== "none"
      : origin !== undefined && origin !== `${site.scheme}://${host}`;
  return foreign
    ? {
        message: "Refused a request from another site.",
        hint: "Submit from this server's own page. Another site's page cannot start a job here, because the job would spend this machine's Codex quota.",
      }
    : null;
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
/** One page per mode: with a token the header carries a logout form, without one it does not. */
const cachedPages = new Map<boolean, string>();
async function uiPage(log: (line: string) => void, auth: boolean): Promise<string> {
  const cached = cachedPages.get(auth);
  if (cached) return cached;
  const specifier = "./ui.js";
  try {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const page = mod.uiPage ?? mod.PAGE ?? mod.page ?? mod.default;
    const html =
      typeof page === "function" ? (page as (o: { auth: boolean }) => string)({ auth }) : page;
    if (typeof html === "string" && html.trim() !== "") {
      cachedPages.set(auth, html);
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
  // No logout form on the stand-in: it is the page for the day ui.js is broken,
  // and clearing the cookie by hand is the price of that day.
  cachedPages.set(auth, FALLBACK_PAGE);
  return FALLBACK_PAGE;
}

/**
 * The way in, when a token is configured and the browser has no session.
 *
 * NO SCRIPT, AND IT LIVES HERE RATHER THAN IN ui.ts: a login that depends on
 * the module the stand-in page exists to survive would lock the operator out on
 * the day that module breaks. The hidden username and `current-password` are for
 * password managers, which is how a 44-character token is meant to be entered.
 * `<!--message-->` is replaced with a fixed sentence and never with input.
 */
const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>DeckSmith — log in</title>
<style>
 body{font:16px/1.5 system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem}
 label{display:block;margin:1rem 0 .25rem;font-weight:600}
 input{box-sizing:border-box;width:100%;font:inherit;padding:.6rem .7rem;border:1px solid #888;border-radius:6px}
 button{margin-top:1rem;font:inherit;padding:.6rem 1.2rem;border-radius:6px;border:0;background:#3d8bfd;color:#fff}
 .err{border:1px solid #c33;border-radius:6px;padding:.6rem .8rem}
 .hint{opacity:.75;font-size:14px}
</style></head><body>
<h1>DeckSmith</h1>
<p>This server needs its token.</p>
<!--message-->
<form method="post" action="/login">
  <input type="text" name="username" value="decksmith" autocomplete="username" hidden>
  <label for="token">Token</label>
  <input id="token" type="password" name="token" autocomplete="current-password" required autofocus>
  <button type="submit">Log in</button>
</form>
<p class="hint">The token is the contents of the file DECKSMITH_TOKEN_FILE names on the server. A session lasts seven days.</p>
</body></html>
`;

/**
 * Enough of an uploader to prove the API end to end without the other agent's
 * page: pick a file OR paste a URL, pick a format, watch the stages, get the
 * links. Deliberately plain — it is a stand-in, not a design.
 *
 * THE FILE INPUT IS NO LONGER `required`, and that is the point of this edit.
 * This page is served whenever `import("./ui.js")` throws, which has happened in
 * production for a reason no gate could see — so a feature that only the real
 * uploader offers is a feature that silently disappears on the day the import
 * breaks. With `required` on the file and no url field, the browser refused to
 * submit a URL job at all. Neither field is required here; sending neither is a
 * 400 whose message says which half to add, and this page renders that message.
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
<p>A document in, an animated deck out. Markdown, a zip holding one, or the address of a page.</p>
<form id="f">
  <fieldset><legend>Document</legend>
    <label>File <input type="file" name="file" accept=".md,.markdown,.txt,.zip"></label>
    <label>or URL <input type="url" name="url" placeholder="https://example.com/article" style="width:22rem;max-width:100%"></label>
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
