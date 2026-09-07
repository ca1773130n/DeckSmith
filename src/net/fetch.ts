/**
 * The one guarded door out of this process for a URL somebody else chose.
 *
 * Two holes made this file. `src/source/assets.ts` fetched a figure with a bare
 * `fetch(src)` — no timeout, no size cap, no idea what came back. And
 * `src/server/pipeline.ts` grew an SSRF pre-check, `reachable()`, which resolves
 * the hostname, refuses the private ranges, and then hands the URL to `fetch`,
 * which resolves it again. A pre-check the socket never honours stops the naive
 * class and nothing else: a public host that 302s to 169.254.169.254 walks
 * straight past it, because the address that was checked is not the address that
 * got connected to.
 *
 * WHY THIS IS node:http/node:https AND NOT `fetch`. Exactly one reason, and it
 * is the reason the file exists: `fetch` gives no way to say "connect to THIS
 * address". `http.request` takes a `lookup`, so the address this module
 * validated is the address the socket opens, and the second DNS answer that
 * would have been a rebinding attack is never asked for. Everything else here —
 * the manual redirect walk, the streaming cap, the timeout, the content-type
 * check — could have been written over `fetch`. The pin could not, and
 * pipeline.ts's own comment named that gap and called it unclosable. It was
 * closable; it just needed a different client.
 *
 * WHAT IS STILL OPEN, because a guard that oversells itself is worse than none:
 *  - Resolution is `dns.lookup`, the OS resolver, so `/etc/hosts` and any local
 *    override are honoured. That is deliberate — it is how this machine resolves
 *    every other name — but it does mean a poisoned hosts file is trusted.
 *  - A hostname with several A records is refused if ANY of them is blocked, and
 *    the socket is pinned to the first. That is stricter than a browser and is
 *    the intended trade: a round-robin where one member is internal is not a
 *    host this process wants to talk to at all.
 *  - Nothing here bounds how many of these run at once. The caller owns that.
 */

import { lookup as resolveHost } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { type RequestOptions as HttpsOptions, request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { VERSION } from "../version.js";

/**
 * Addresses this process may not be sent to, copied from `reachable()` in
 * src/server/pipeline.ts and extended.
 *
 * The intent of the original list, kept: resolution happens first, and the
 * RESOLVED address is what gets judged — never the spelling. That is what makes
 * `http://0177.0.0.1/`, `http://2130706433/` and a hostname whose A record is
 * 10.0.0.1 all one case instead of three, and it is why plain regexes are safe
 * here where they would not be against a raw URL: by the time they run, the
 * input is a canonical dotted quad that `net.isIP` has already accepted, so
 * there is no octal, no short form and no decimal-integer spelling left to miss.
 *
 * The five entries the original missed are marked. The metadata service on
 * 169.254.169.254 is the classic target and it was already covered; the gaps
 * were the ranges nobody thinks of as "private" but which still reach something
 * that answers without asking who is calling.
 */
const BLOCKED_V4: { re: RegExp; why: string }[] = [
  // "This network". Already in the original list as /^0\./, which is 0.0.0.0/8.
  { re: /^0\./, why: "the unspecified network (0.0.0.0/8)" },
  { re: /^10\./, why: "a private address (10.0.0.0/8)" },
  // NEW: carrier-grade NAT. A mobile or datacentre network hands these out, and
  // on a host that has one, the whole /10 is the neighbourhood.
  {
    re: /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
    why: "carrier-grade NAT space (100.64.0.0/10)",
  },
  { re: /^127\./, why: "loopback (127.0.0.0/8)" },
  { re: /^169\.254\./, why: "link-local, where the cloud metadata service lives (169.254.0.0/16)" },
  { re: /^172\.(1[6-9]|2\d|3[01])\./, why: "a private address (172.16.0.0/12)" },
  // NEW: IETF protocol assignments — 192.0.0.8, the NAT64 well-known prefix and
  // friends. Not routable on the public internet, so a URL pointing here is
  // pointing at something local.
  { re: /^192\.0\.0\./, why: "IETF protocol assignment space (192.0.0.0/24)" },
  { re: /^192\.168\./, why: "a private address (192.168.0.0/16)" },
  // NEW: benchmarking. Reserved for test equipment, and some networks route it
  // internally precisely because it will never collide with anything real.
  { re: /^198\.1[89]\./, why: "benchmarking space (198.18.0.0/15)" },
];

/**
 * The reason `ip` may not be connected to, or null if it may.
 *
 * Anything that is not an IP address is refused rather than passed through: this
 * is handed the output of a resolver, and a caller that hands it a hostname has
 * made a mistake that must not read as "allowed".
 */
/**
 * What we tell a server we are. A real URL and a version, because the polite
 * form of this header is the one an operator can act on: it names the tool, so a
 * site that does not want us can say so precisely rather than blanket-blocking.
 */
const USER_AGENT = `DeckSmith/${VERSION} (+https://github.com/ca1773130n/DeckSmith)`;

export function isBlockedAddress(ip: string): string | null {
  const bare = ip
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  const kind = isIP(bare);
  if (kind === 0) return `not an IP address (${ip})`;
  if (kind === 4) {
    for (const { re, why } of BLOCKED_V4) if (re.test(bare)) return why;
    return null;
  }

  const groups = expandV6(bare);
  if (groups === null) return `not an IP address (${ip})`;
  if (groups.every((n) => n === 0)) return "the unspecified address (::)";
  if (groups.slice(0, 7).every((n) => n === 0) && groups[7] === 1) return "IPv6 loopback (::1)";

  /**
   * THE MAPPED FORM IS THE ONE THAT GETS THROUGH, and it is worth saying why.
   * `::ffff:127.0.0.1` is a perfectly ordinary IPv6 address that a socket routes
   * to 127.0.0.1. `net.isIP` calls it family 6, so every IPv4 regex above is
   * skipped — /^127\./ never sees a string starting with "127" — and an IPv6
   * check written as a prefix list ("::1", "fe80:", "fc", "fd") does not match
   * it either. It falls between the two halves of the check and is allowed. The
   * hex spelling `::ffff:7f00:1` is the same address and defeats even a regex
   * written specifically for the dotted mapped form, which is why this expands
   * the address to its eight groups and judges the numbers rather than the text.
   *
   * And the hex spelling is not the exotic case, it is the ONLY case. Measured
   * while writing test/net.test.ts: `new URL("http://[::ffff:127.0.0.1]/")`
   * normalises its host to `[::ffff:7f00:1]`, so a guard downstream of URL
   * parsing never sees the dotted form at all. A check written for the spelling
   * everyone reaches for would have fired zero times in production.
   *
   * `::127.0.0.1` (IPv4-compatible, deprecated but still parsed) is the same
   * trick with the ffff group left out, so it is folded in here too. Both land
   * back in the IPv4 table, which is where the ranges are stated once.
   */
  const embedded =
    groups.slice(0, 5).every((n) => n === 0) && (groups[5] === 0xffff || groups[5] === 0);
  if (embedded) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }

  // fe80::/10 and fc00::/7 as ranges, not as the "fe80:"/"fc"/"fd" string
  // prefixes the original used. Same intent, and the range form also catches
  // febf:: — nothing legitimate lives there, so widening costs nothing.
  const top = groups[0] ?? 0;
  if ((top & 0xffc0) === 0xfe80) return "IPv6 link-local (fe80::/10)";
  if ((top & 0xfe00) === 0xfc00) return "IPv6 unique-local (fc00::/7)";
  return null;
}

/** The eight 16-bit groups of an IPv6 literal, or null if it will not expand. */
function expandV6(v6: string): number[] | null {
  let text = v6;
  // A trailing dotted quad is the low two groups written in IPv4 notation. Fold
  // it to hex first so the rest of this only has to think about one syntax.
  const quad = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (quad?.[1]) {
    const [a = 0, b = 0, c = 0, d = 0] = quad[1].split(".").map(Number);
    const head = text.slice(0, text.length - quad[1].length);
    text = `${head}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  const fill = 8 - left.length - (right?.length ?? 0);
  if (right !== null && fill < 0) return null;
  const parts = right === null ? left : [...left, ...new Array<string>(fill).fill("0"), ...right];
  if (parts.length !== 8) return null;
  const groups = parts.map((p) => Number.parseInt(p, 16));
  return groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

/** Loopback, for the one exemption `allowLoopback` grants. Nothing else. */
function isLoopback(ip: string): boolean {
  const bare = ip
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return /^127\./.test(bare) || bare === "::1" || /^::ffff:127\./.test(bare);
}

/**
 * How many redirects are followed before the chain is called a loop. Five is the
 * number browsers settled on for the same reason: a legitimate chain is one or
 * two hops (http→https, apex→www), and past five the only thing being measured
 * is how long the attacker is willing to keep the socket open.
 */
const MAX_REDIRECTS = 5;

/** The only ports a URL may name. Anything else is a service, not a web page. */
const WEB_PORTS = new Set([80, 443]);

/** Statuses that carry a `Location` worth following. 303 is safe: this is GET. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Headers that must never survive a change of origin. A redirect is the classic
 * way to make a client hand a bearer token to a server that was never meant to
 * see it, and the redirect is chosen by whoever wrote the page, not by us.
 */
const CREDENTIALS = ["authorization", "cookie"];

export interface GuardOptions {
  /**
   * Cap on the body, applied to DECODED bytes — see `readCapped` and `decode`
   * for the two places it is enforced and why it takes both.
   */
  maxBytes: number;
  /** Whole-call budget: DNS, connect, every hop, and reading the body. */
  timeoutMs: number;
  /**
   * Refuse unless the response's bare media type matches. Matched against the
   * type WITHOUT its parameters, so `/^image\//` and `/^text\/html$/` both do
   * what they look like against `text/html; charset=utf-8`.
   */
  accept?: RegExp;
  /**
   * Extra request headers, lowercased on the way in. `authorization` and
   * `cookie` are dropped the moment a redirect changes origin.
   */
  headers?: Record<string, string>;
  /**
   * TEST SEAM, and the only way to point this at a server on this machine.
   *
   * It exempts loopback from the address block and lifts the 80/443 rule, which
   * together is exactly what it takes to drive a `node:http` server on an
   * ephemeral port through this module's real code path — see test/net.test.ts,
   * which is the only caller. It relaxes NOTHING else: link-local, the private
   * ranges, the non-http schemes, the hop cap, the size cap, the timeout and the
   * content-type check all still apply, which is what makes those tests evidence
   * about the guard rather than about a bypass of it. Nothing in src passes it.
   */
  allowLoopback?: boolean;
}

export interface Fetched {
  bytes: Buffer;
  /** The `Content-Type` header as sent, parameters and all — a caller decoding
   * text needs the charset, and dropping it here would lose it for good. */
  contentType: string;
  /** The URL the bytes actually came from, after redirects. What a caller must
   * resolve relative links against, and what it should cache under. */
  url: string;
}

/**
 * Fetch `url`, refusing loudly at the first thing that looks wrong.
 *
 * Every refusal names the URL, what was wrong with it, and what to do; a caller
 * surfacing `err.message` to a user is giving them something actionable.
 */
export async function fetchGuarded(url: string, opts: GuardOptions): Promise<Fetched> {
  // One budget for the whole call, not one per hop: five hops that each take
  // just under the limit is the same denial of service as one that hangs.
  const signal = AbortSignal.timeout(opts.timeoutMs);

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error(`refusing ${url}: not a URL. Give an absolute http:// or https:// URL.`);
  }

  let headers = lowercased(opts.headers);
  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) {
      throw new Error(
        `refusing ${url}: more than ${MAX_REDIRECTS} redirects, last to ${target.href}. ` +
          `Link the final URL directly.`,
      );
    }

    const res = await send(url, target, headers, signal, opts);
    const status = res.statusCode ?? 0;

    if (REDIRECTS.has(status)) {
      const location = res.headers.location;
      // Destroy rather than drain. Draining keeps the socket reusable, but the
      // body of a redirect is bytes an attacker chose the length of, and reading
      // them to be polite is the size cap all over again.
      res.destroy();
      if (location === undefined) {
        throw new Error(`refusing ${url}: HTTP ${status} from ${target.href} with no Location.`);
      }
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        throw new Error(
          `refusing ${url}: HTTP ${status} to an unparseable Location (${location}).`,
        );
      }
      // Origin, not host: a different port on the same name is a different
      // server, and handing it a token because the hostname matched is the leak
      // this rule exists to stop. Protocol counts too — https→http is a
      // downgrade that puts the header on the wire in clear.
      const sameOrigin =
        next.protocol === target.protocol &&
        next.hostname === target.hostname &&
        next.port === target.port;
      if (!sameOrigin) headers = withoutCredentials(headers);
      target = next;
      continue;
    }

    if (status < 200 || status >= 300) {
      res.destroy();
      throw new Error(`${target.href}: HTTP ${status}`);
    }

    const contentType = (res.headers["content-type"] ?? "").trim();
    const media = (contentType.split(";")[0] ?? "").trim().toLowerCase();
    // `match`, not `test`: a caller's regex may carry the /g flag, and `test` on
    // a global regex advances lastIndex, so the same check would alternate
    // between pass and fail across calls. `match` ignores it.
    if (opts.accept && media.match(opts.accept) === null) {
      res.destroy();
      throw new Error(
        `refusing ${url}: ${target.href} served ${media || "no Content-Type"}, ` +
          `which does not match ${opts.accept}. Link the file itself, not a page about it.`,
      );
    }

    const raw = await readCapped(res, opts.maxBytes, url, signal, opts.timeoutMs);
    const bytes = decode(raw, res.headers["content-encoding"], opts.maxBytes, url);
    return { bytes, contentType, url: target.href };
  }
}

/**
 * One hop: validate, resolve, validate the answer, then connect to the answer.
 *
 * The order matters. Scheme and port are judged from the URL because they cost
 * nothing; the address is judged after resolution because that is the only thing
 * that is true. Nothing between the check and the socket can change the address,
 * because the socket is told which address to use.
 *
 * `auth` is deliberately never set, so userinfo in the URL —
 * `http://user:pass@host/` — does not become an Authorization header and does
 * not leave this process. A URL carrying a password is not a URL that was meant
 * to be fetched by a server on somebody else's behalf.
 */
async function send(
  url: string,
  target: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  opts: GuardOptions,
): Promise<IncomingMessage> {
  const secure = target.protocol === "https:";
  if (!secure && target.protocol !== "http:") {
    throw new Error(
      `refusing ${url}: ${target.protocol}// is not http or https ` +
        `(${target.href}). Only web URLs are followed.`,
    );
  }

  const port = Number(target.port || (secure ? 443 : 80));
  if (!WEB_PORTS.has(port) && opts.allowLoopback !== true) {
    throw new Error(
      `refusing ${url}: port ${port} on ${target.hostname} — only 80 and 443 are fetched. ` +
        `A URL naming another port is naming a service, not a page.`,
    );
  }

  const host = target.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try {
    // Raced against the signal because `dns.lookup` takes none. getaddrinfo
    // against a nameserver that answers slowly or not at all sits for the OS
    // resolver's own budget — tens of seconds, retries included — which is long
    // enough to make `timeoutMs` a suggestion rather than a bound, and a
    // hostname whose nameserver is chosen by the same document that chose the
    // URL is not a hostname to be patient with.
    addresses = await Promise.race([resolveHost(host, { all: true }), rejectsOnAbort(signal)]);
  } catch {
    if (signal.aborted) throw timedOut(url, opts.timeoutMs);
    throw new Error(`refusing ${url}: ${host} does not resolve.`);
  }
  const pinned = addresses[0];
  if (pinned === undefined) throw new Error(`refusing ${url}: ${host} does not resolve.`);
  for (const { address } of addresses) {
    const why = isBlockedAddress(address);
    if (why !== null && !(opts.allowLoopback === true && isLoopback(address))) {
      throw new Error(
        `refusing ${url}: ${host} resolves to ${address}, which is ${why}. ` +
          `Host the file somewhere this server can reach from the public internet.`,
      );
    }
  }

  const options: HttpsOptions = {
    hostname: host,
    port,
    path: `${target.pathname}${target.search}`,
    method: "GET",
    // IDENTIFY OURSELVES, AND ACCEPT HTML.
    //
    // Measured against the first real page this was ever pointed at: Wikipedia
    // answers a request with no `user-agent` with a bare 403, and so do a great
    // many sites behind a CDN. A fetcher that will not say who it is looks
    // exactly like a scraper worth blocking, and the failure arrives as an
    // HTTP status with nothing in it to explain itself. Both headers are
    // DEFAULTS rather than overrides — a caller that sets either wins, because
    // the spread below them is the caller's.
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
      ...headers,
      "accept-encoding": "gzip, br",
    },
    signal,
    // THE PIN. Without this line every check above is advisory: `dns.lookup`
    // would run a second time inside the connect and could answer differently.
    lookup: pin(pinned.address, pinned.family),
    // No connection pool. This is a one-shot against a stranger's host, and a
    // pooled socket outlives the call that validated it — nothing should be able
    // to inherit a connection this module opened.
    agent: false,
    // Say out loud which name the certificate has to match. Node derives this
    // from `hostname` today, but the pin means the socket is opened to a bare
    // address, and a future refactor that stops setting `hostname` would turn
    // verification off silently rather than fail.
    ...(secure && isIP(host) === 0 ? { servername: host } : {}),
  };

  try {
    return await new Promise<IncomingMessage>((resolve, reject) => {
      const req = (secure ? httpsRequest : httpRequest)(options, resolve);
      req.on("error", reject);
      req.end();
    });
  } catch (err) {
    if (signal.aborted) throw timedOut(url, opts.timeoutMs);
    throw new Error(`refusing ${url}: ${target.href} could not be reached (${message(err)}).`);
  }
}

/**
 * A `lookup` that answers with the address already validated, and only that one.
 *
 * `net.connect` calls this with `all: true` when Happy Eyeballs is on (the
 * default since Node 20) and `all: false` otherwise, so both shapes are
 * answered — getting that wrong throws inside the connect with an error that
 * names neither this function nor the reason.
 */
function pin(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * Read the body, refusing past `maxBytes` WHILE it arrives.
 *
 * Content-Length is a claim, not a fact — and usually not even a claim. A
 * chunked response declares no length at all, which is exactly what a body with
 * no end looks like on the wire, so a guard written against the header has
 * nothing to read in the case that matters. The only number that is true is the
 * one counted off the socket, so that is the one this counts, chunk by chunk,
 * destroying the response the moment it is crossed. That is the difference
 * between refusing a 4 GB body and refusing it after allocating it.
 */
async function readCapped(
  res: IncomingMessage,
  maxBytes: number,
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  // Break out and throw AFTER the try, rather than throwing from inside it. The
  // catch below is there to translate a stream failure into something that names
  // the URL, and a refusal thrown into it would be caught and reworded as one —
  // which is how a size cap ends up reported as a network error.
  let oversize = false;
  try {
    for await (const chunk of res as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > maxBytes) {
        oversize = true;
        res.destroy();
        break;
      }
      chunks.push(chunk);
    }
  } catch (err) {
    if (signal.aborted) throw timedOut(url, timeoutMs);
    throw new Error(`refusing ${url}: the body stopped arriving (${message(err)}).`);
  }
  if (oversize) {
    throw new Error(
      `refusing ${url}: body is larger than ${maxBytes} bytes. ` +
        `Link a smaller file, or raise maxBytes if this one is expected.`,
    );
  }
  return Buffer.concat(chunks);
}

/**
 * Decompress, with the cap applied to the DECODED bytes.
 *
 * This is where a decompression bomb dies. `readCapped` bounds what arrives on
 * the wire, which is not the same number: gzip reaches about 1000:1 on a stream
 * of zeros, so a 4 KB body inside a 4 MB cap can still be a 4 GB allocation. So
 * the same cap is passed to zlib as `maxOutputLength`, which throws rather than
 * allocating past it, and the guard holds in both directions.
 *
 * WHAT `fetch` WOULD HAVE DONE, since the alternative deserves an answer:
 * undici decompresses Content-Encoding transparently and hands `res.body` the
 * decoded stream, so counting there is also post-decompression and would also
 * have been correct. What it does not give is a bound on the COMPRESSED input
 * independently of the decoded one — nor the pinned connection this module was
 * written for. Here both numbers are capped, and neither buffer can exceed
 * maxBytes.
 *
 * Only gzip and br are requested, and only those are accepted. `deflate` is left
 * out on purpose: servers disagree about whether it means zlib-wrapped or raw,
 * browsers paper over it by trying both, and guessing at a decoder is not
 * something this file should be doing. An encoding that was not asked for is a
 * server doing something odd, and is refused by name rather than decoded on a
 * hunch.
 */
function decode(raw: Buffer, header: string | undefined, maxBytes: number, url: string): Buffer {
  const encoding = (header ?? "").trim().toLowerCase();
  if (encoding === "" || encoding === "identity") return raw;
  try {
    if (encoding === "gzip" || encoding === "x-gzip") {
      return gunzipSync(raw, { maxOutputLength: maxBytes });
    }
    if (encoding === "br") return brotliDecompressSync(raw, { maxOutputLength: maxBytes });
  } catch (err) {
    throw new Error(
      `refusing ${url}: ${encoding} body does not decompress within ${maxBytes} bytes ` +
        `(${message(err)}). Serve it uncompressed, or raise maxBytes.`,
    );
  }
  throw new Error(
    `refusing ${url}: Content-Encoding "${encoding}" was never offered — ` +
      `this request asked for gzip or br. Serve one of those, or no encoding.`,
  );
}

/** Header names are case-insensitive; the credential strip is not, so fold now. */
function lowercased(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) out[name.toLowerCase()] = value;
  return out;
}

function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  const out = { ...headers };
  for (const name of CREDENTIALS) delete out[name];
  return out;
}

/** A promise that never resolves and rejects the moment `signal` aborts. */
function rejectsOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function timedOut(url: string, timeoutMs: number): Error {
  return new Error(
    `refusing ${url}: nothing completed within ${timeoutMs}ms. ` +
      `Raise timeoutMs, or use a URL that answers faster.`,
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
