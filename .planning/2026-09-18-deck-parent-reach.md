# What a deck's script can still reach, with a token on

**A deck opened on its own can no longer post a job, by either route it has. A
deck shown inside the uploader still can.** The first result took two fixes, not
one: the anti-framing headers in §1, and — after a reviewer pointed out that the
conclusion in §3 did not follow from its own evidence — `connect-src 'none'` on
`/examples/embed.html` in §3. The second is a hole that stays open, and the
README says so.

§3 is also a record of getting this wrong in the direction that feels safe: three
true statements, one conclusion that did not follow, and a browser measurement
that settled it in a minute once anyone thought to make it.

Measured 2026-09-18 on macOS, Node 24.14.0, puppeteer-core 25.10.0, and the
renderer's Chrome (chrome-headless-shell 152.0.7977.30 from the hyperframes
cache). The server ran from `feat/server-auth-tls` with a token file set. The
pipeline was a stub, so no Codex ran.

## 1. A deck opened top-level (B1)

A stub deck at `/d/<id>/deck.html` gets the usual deck CSP (`sandbox
allow-scripts allow-same-origin allow-downloads; connect-src 'none'; frame-src
'self' …`). Its script frames a same-origin URL and calls
`frame.contentWindow.fetch("/api/jobs", {method: "POST"})`. The viewer is logged
in through the real form. `depth` counts waiting jobs; the first job accepted
starts running and does not count, so a depth of 2 is three accepted jobs.

| framed URL | with the framing headers | control: headers removed (`frameHeaders: false`) |
| --- | --- | --- |
| `/` (the uploader) | `SecurityError: Blocked a frame … from accessing a cross-origin frame` | `status 202` |
| `/api/formats` | same `SecurityError` | `status 202` |
| `/d/<id>/missing.html` (a /d/ 404) | same `SecurityError` | `status 202` |
| jobs accepted | **0** (depth 0) | **3** (depth 2, one running) |

So `connect-src 'none'` never isolated a deck by itself. Any other same-origin
response it could frame gave it a realm without that rule: the uploader, a JSON
answer, even /d/'s own error pages. `X-Frame-Options: DENY` plus
`frame-ancestors 'none'; sandbox` on every non-deck response closes this, and the
control shows the hole was real. `test/server.test.ts` "B1" asserts both columns.

## 2. A deck shown inside the uploader (M1)

The same kind of stub deck, reached by finishing a job in the uploader. The page
mounts it in an iframe (a source tree has no `dist/deck-player-element.js`, so
the page uses its iframe fallback; `<decksmith-player>` also builds an iframe
with no `sandbox` attribute). The deck's script runs:

```js
parent.fetch("/api/jobs", { method: "POST", body: fd })
```

Result: **`status 202`, and the pipeline was called a second time.** The deck is
same-origin with its parent (`allow-same-origin` is load-bearing, see
src/server/http.ts). `parent.fetch` is the uploader's `fetch` and runs under the
uploader's policy, which has no `connect-src`. The browser attaches the session
cookie and the `Origin`, so `foreignRequest` and the cookie-write rule both pass.

`test/server.test.ts` "M1" pins this result on purpose. When decks move to their
own origin it should flip to a refusal, and the README's "What is missing" should
change in the same commit.

## 3. A deck steering the viewer into embed.html (B7)

**This section said the opposite until the same day, and it was wrong.** What it
said was that nothing on another site can put a deck next to the viewer's
session, because the cookie is `SameSite=Strict` and `/examples/embed.html` is
behind the token. Both facts are true and the conclusion does not follow.

`SameSite=Strict` withholds the cookie from a navigation ANOTHER SITE starts. It
sends it on one THIS ORIGIN starts. `/d/` is public and a deck opens top-level,
so a link from anywhere puts a hostile deck on screen as its own top-level
document — and a top-level document is not subject to `allow-top-navigation`,
which governs a nested one navigating its parent. It can set `location`. That
second hop is same-site, and it carries the session.

Measured 2026-09-18, same machine and Chrome as above, through the BUILT server
(a source tree has no `dist/embed.html`, so /examples/embed.html is a 500 there
and a source server would have "passed" by serving nothing). The deck's script:

```js
if (window.top === window) location.href = "/examples/embed.html?a=" + ownDirectory;
else parent.fetch("/api/jobs", { method: "POST", body: fd });
```

Chrome followed the link from another site to `/d/<id>/deck.html` with **no
cookie**, as B5 says; the deck then navigated itself, and that request for
`/examples/embed.html?a=…` arrived **with the session cookie** and got **200**.
embed.html framed the attacker's own deck, same-origin with it, and:

| embed.html's CSP | `parent.fetch("/api/jobs")` | jobs queued |
| --- | --- | --- |
| CONTROL, as the PR shipped it (`PAGE_CSP`) | `status 202` | **1, as the viewer** |
| with `connect-src 'none'` (`EMBED_CSP`) | `rejected TypeError` | **0** |

One directive, and nothing else changed between the rows. It costs the page
nothing: neither `examples/embed.html` nor `src/deck/player.ts` makes a `fetch`,
`XMLHttpRequest`, `EventSource`, `sendBeacon` or WebSocket, and `connect-src`
does not govern framing, so the decks it exists to show still load.
`test/server.test.ts` "B7" pins both halves — that the steering navigation still
carries the session, and that the fetch is refused anyway.

## 4. A second listener on this host (M2)

Also measured, and also not what the PR assumed. Cookies have no port (RFC 6265
§1), so a plain `http.createServer` on another port of `127.0.0.1` was sent this
server's cookie by the browser, name and value, on an ordinary navigation. The
cookie is now named `decksmith-<port>` and its MAC covers `host:port`, which
stops two instances colliding and stops either honouring the other's session —
but it does not and cannot hide the value from a neighbour. `test/server.test.ts`
"M2" pins it, and the README says plainly what that lets a local account do.

## 5. What that means

What is left needs the operator to convert hostile content, for script to survive
into the deck, and for the operator to watch it **in the uploader** — the one page
that must be able to reach the API and so cannot have `connect-src`.
`jobsPerHour` still caps what that script can spend. The real fix for all of it —
M1, B7 and M2 together — is serving `/d/` from a separate origin, which a
`__Host-` cookie would never reach. That is the next design, and it is not built.
