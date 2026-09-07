/**
 * The outbound guard, against a real socket.
 *
 * This is the first coverage `fetchGuarded`'s rules have ever had, and the shape
 * of the file is a reaction to how the old coverage failed. test/server.test.ts
 * has a case asserting that `http://169.254.169.254/latest/meta-data/` does not
 * get fetched — and it passes because that suite sets `fetchRemoteFigures:
 * false`, so nothing ever tried. A test that would pass with the guard deleted
 * is not evidence about the guard. So everything below stands up an actual
 * `node:http` server on loopback and drives the real code path into it: real
 * redirects, real chunked bodies, real gzip, real headers read back off the
 * request the guard sent.
 *
 * Reaching loopback at all needs `allowLoopback`, which is the module's declared
 * test seam. It exempts 127.0.0.0/8 and lifts the 80/443 rule and does nothing
 * else — so the refusals asserted here (link-local, oversize, timeout, wrong
 * media type, dropped credentials) are the production rules firing, not a
 * relaxed variant of them. The one thing that would be worth having and cannot
 * be had is a public address to point at: every address in this file is either
 * loopback or a literal that `dns.lookup` short-circuits, so NOTHING HERE
 * REACHES THE NETWORK.
 */
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { fetchGuarded, isBlockedAddress } from "../src/net/fetch.js";

/* ------------------------------------------------------------------ addresses */

describe("isBlockedAddress", () => {
  it.each([
    ["0.0.0.0", /unspecified network/],
    ["10.1.2.3", /10\.0\.0\.0\/8/],
    ["100.64.0.1", /carrier-grade NAT/],
    ["100.127.255.255", /carrier-grade NAT/],
    ["127.0.0.1", /loopback/],
    ["127.1.2.3", /loopback/],
    ["169.254.169.254", /link-local/],
    ["172.16.0.1", /172\.16\.0\.0\/12/],
    ["172.31.255.255", /172\.16\.0\.0\/12/],
    ["192.0.0.8", /IETF protocol assignment/],
    ["192.168.1.1", /192\.168\.0\.0\/16/],
    ["198.18.0.1", /benchmarking/],
    ["198.19.255.255", /benchmarking/],
    ["::", /unspecified address/],
    ["::1", /IPv6 loopback/],
    ["fe80::1", /IPv6 link-local/],
    ["febf::1", /IPv6 link-local/],
    ["fc00::1", /IPv6 unique-local/],
    ["fd12:3456:789a::1", /IPv6 unique-local/],
    // The mapped forms, which are the ones a naive check lets through: family 6
    // to `isIP`, so the IPv4 table is skipped, and not a prefix any IPv6 string
    // check would list. The third spelling is the same address in hex, which
    // even a regex written for the dotted mapped form misses.
    ["::ffff:127.0.0.1", /loopback/],
    ["::ffff:169.254.169.254", /link-local/],
    ["::ffff:7f00:1", /loopback/],
    ["::ffff:10.0.0.1", /10\.0\.0\.0\/8/],
    ["::127.0.0.1", /loopback/],
    ["[::ffff:192.168.0.1]", /192\.168\.0\.0\/16/],
    // Not an address at all. Refused rather than passed through: this is handed
    // the output of a resolver, so a hostname arriving here is a caller bug that
    // must not read as "allowed".
    ["example.com", /not an IP address/],
    ["", /not an IP address/],
    ["0177.0.0.1", /not an IP address/],
  ])("blocks %s", (ip, why) => {
    expect(isBlockedAddress(ip)).toMatch(why);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    // The edges just outside each range this file added, so a widened regex
    // would be caught rather than silently costing someone a real host.
    "100.63.255.255",
    "100.128.0.1",
    "172.15.0.1",
    "172.32.0.1",
    "192.0.1.1",
    "198.17.255.255",
    "198.20.0.1",
    "2606:4700::1111",
    "2001:db8::1",
  ])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBeNull();
  });
});

/* ---------------------------------------------------------------- the fetching */

describe("fetchGuarded", () => {
  const shut: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of shut.splice(0)) await close();
  });

  /** A real server on an ephemeral loopback port, torn down after each test. */
  async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    const server = createServer(handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    shut.push(
      () =>
        new Promise<void>((r) => {
          // The timeout test leaves a request hanging on purpose, and `close`
          // alone waits for it forever.
          server.closeAllConnections();
          server.close(() => r());
        }),
    );
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }

  const local = { maxBytes: 1 << 20, timeoutMs: 2_000, allowLoopback: true };

  it("returns the bytes, the content type as sent, and the URL it ended on", async () => {
    const { base } = await serve((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/moved.png" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "image/png; charset=binary" });
      res.end("PNGDATA");
    });
    const got = await fetchGuarded(`${base}/start`, local);
    expect(got.bytes.toString()).toBe("PNGDATA");
    // Parameters kept: a caller decoding text needs the charset, and this is the
    // only place it exists.
    expect(got.contentType).toBe("image/png; charset=binary");
    // The URL after the redirect, because that is what relative links inside the
    // body resolve against.
    expect(got.url).toBe(`${base}/moved.png`);
  });

  it("refuses a redirect to a private address, which no pre-flight check can catch", async () => {
    // The whole reason this module exists. The first hop is a host that passes
    // every check; the second is the cloud metadata service. `reachable()` in
    // pipeline.ts approves this URL, because it only ever sees the first hop.
    const { base } = await serve((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    await expect(fetchGuarded(`${base}/harmless.png`, local)).rejects.toThrow(
      /169\.254\.169\.254 resolves to 169\.254\.169\.254, which is link-local/,
    );
  });

  it("refuses a redirect that leaves http", async () => {
    const { base } = await serve((_req, res) => {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    });
    await expect(fetchGuarded(`${base}/harmless.png`, local)).rejects.toThrow(
      /file:\/\/ is not http or https/,
    );
  });

  it("refuses a redirect chain that never lands", async () => {
    const { base } = await serve((req, res) => {
      res.writeHead(302, { location: `/hop${req.url}` });
      res.end();
    });
    await expect(fetchGuarded(`${base}/a`, local)).rejects.toThrow(/more than 5 redirects/);
  });

  it("refuses an oversized body while it is still arriving", async () => {
    // Chunked, so there is no Content-Length to consult even if consulting one
    // were worth anything. `written` is the evidence that the refusal happened
    // mid-stream: a guard that buffered first and measured afterwards would let
    // the server write all 64 MB before deciding.
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    let written = 0;
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      let open = true;
      res.on("close", () => {
        open = false;
      });
      const pump = () => {
        while (open && written < 64 * 1024 * 1024) {
          written += chunk.length;
          if (!res.write(chunk)) {
            res.once("drain", pump);
            return;
          }
        }
        if (open) res.end();
      };
      pump();
    });
    await expect(fetchGuarded(`${base}/big.bin`, { ...local, maxBytes: 4096 })).rejects.toThrow(
      /body is larger than 4096 bytes/,
    );
    expect(written).toBeLessThan(16 * 1024 * 1024);
  });

  it("accepts a body that fits", async () => {
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(Buffer.alloc(4000, 0x62));
    });
    const got = await fetchGuarded(`${base}/ok.bin`, { ...local, maxBytes: 4096 });
    expect(got.bytes.length).toBe(4000);
  });

  it("gives up on a server that never answers", async () => {
    const { base } = await serve(() => {
      /* headers written, body never; the socket just sits there */
    });
    await expect(fetchGuarded(`${base}/hang`, { ...local, timeoutMs: 80 })).rejects.toThrow(
      /nothing completed within 80ms/,
    );
  });

  it("refuses a page pretending to be an image", async () => {
    // The masquerade that matters downstream: `imageSize` would throw
    // "unrecognised image header" on this, three functions away from the URL
    // that caused it. Refusing here names the URL and what it actually served.
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>Sign in to view this figure</body></html>");
    });
    await expect(
      fetchGuarded(`${base}/figure.png`, { ...local, accept: /^image\// }),
    ).rejects.toThrow(/served text\/html, which does not match/);
  });

  it("matches accept against the media type without its parameters", async () => {
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html></html>");
    });
    // `/^text\/html$/` would never match "text/html; charset=utf-8" if the
    // parameters were left on, which is the footgun the stripping avoids.
    const got = await fetchGuarded(`${base}/page.html`, { ...local, accept: /^text\/html$/ });
    expect(got.bytes.toString()).toContain("<html>");
  });

  it("drops Authorization and Cookie across an origin change, and keeps them within one", async () => {
    const seen: Record<string, IncomingHttpHeaders> = {};
    const other = await serve((req, res) => {
      seen.other = req.headers;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("landed");
    });
    const first = await serve((req, res) => {
      if (req.url === "/away") {
        res.writeHead(302, { location: `${other.base}/landed` });
        res.end();
        return;
      }
      if (req.url === "/within") {
        res.writeHead(302, { location: "/same-origin" });
        res.end();
        return;
      }
      seen.same = req.headers;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("same");
    });
    const headers = {
      Authorization: "Bearer super-secret",
      Cookie: "session=super-secret",
      "X-Trace": "keep-me",
    };

    await fetchGuarded(`${first.base}/away`, { ...local, headers });
    expect(seen.other?.authorization).toBeUndefined();
    expect(seen.other?.cookie).toBeUndefined();
    // Only the credentials go. A non-credential header is not the sender's
    // problem and dropping it would break callers for no gain.
    expect(seen.other?.["x-trace"]).toBe("keep-me");

    await fetchGuarded(`${first.base}/within`, { ...local, headers });
    expect(seen.same?.authorization).toBe("Bearer super-secret");
    expect(seen.same?.cookie).toBe("session=super-secret");
  });

  it("caps decompressed bytes, so a small gzip cannot become a large buffer", async () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0));
    // The premise: this sails under any cap applied to the wire.
    expect(bomb.length).toBeLessThan(64 * 1024);
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(bomb);
    });
    await expect(
      fetchGuarded(`${base}/bomb.txt`, { ...local, maxBytes: 128 * 1024 }),
    ).rejects.toThrow(/gzip body does not decompress within 131072 bytes/);
  });

  it("decompresses a gzip body that fits", async () => {
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.from("compressed but small")));
    });
    const got = await fetchGuarded(`${base}/small.txt`, local);
    expect(got.bytes.toString()).toBe("compressed but small");
  });

  it("refuses an encoding it never asked for rather than guessing at a decoder", async () => {
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "deflate" });
      res.end(Buffer.from("whatever"));
    });
    await expect(fetchGuarded(`${base}/odd.txt`, local)).rejects.toThrow(
      /Content-Encoding "deflate" was never offered/,
    );
  });

  it("passes a non-2xx status through, naming it", async () => {
    const { base } = await serve((_req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("gone");
    });
    await expect(fetchGuarded(`${base}/missing.png`, local)).rejects.toThrow(/HTTP 404/);
  });

  /* The refusals that never open a socket. Every address here is a literal, so
   * `dns.lookup` short-circuits it and no resolver is consulted. */

  it("refuses the IPv4-mapped IPv6 spelling of loopback", async () => {
    // MEASURED, and it changes what an implementation has to handle: `new URL`
    // does not keep the dotted spelling. It normalises
    // `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so by the time any guard sees
    // this host it is in hex — and a check written for the dotted mapped form,
    // which is the form everyone writes the test for, would never fire once. It
    // is the group expansion that catches it, not the spelling.
    await expect(
      fetchGuarded("http://[::ffff:127.0.0.1]/latest/meta-data/", {
        maxBytes: 1024,
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/::ffff:7f00:1 resolves to ::ffff:7f00:1, which is loopback/);
  });

  it("refuses loopback without the test seam", async () => {
    const { base } = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("should never be read");
    });
    // Same server the tests above talk to, with `allowLoopback` off: the port
    // rule catches it first, and the address rule would have caught it after.
    await expect(fetchGuarded(`${base}/x`, { maxBytes: 1024, timeoutMs: 500 })).rejects.toThrow(
      /only 80 and 443 are fetched/,
    );
    await expect(
      fetchGuarded("http://127.0.0.1/x", { maxBytes: 1024, timeoutMs: 500 }),
    ).rejects.toThrow(/which is loopback/);
  });

  it("refuses a URL that is not http or https", async () => {
    await expect(
      fetchGuarded("file:///etc/passwd", { maxBytes: 1024, timeoutMs: 500 }),
    ).rejects.toThrow(/file:\/\/ is not http or https/);
  });

  it("refuses something that is not a URL", async () => {
    await expect(fetchGuarded("not a url", { maxBytes: 1024, timeoutMs: 500 })).rejects.toThrow(
      /not a URL/,
    );
  });
});
