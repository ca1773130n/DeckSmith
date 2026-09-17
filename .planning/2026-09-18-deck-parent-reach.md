# What a deck's script can still reach, with a token on

**A deck opened on its own can no longer post a job. A deck shown inside the
uploader still can.** The first result is new with the anti-framing headers
that came in alongside the token. The second is a hole that stays open, and the
README now says so.

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

## 3. What that means

The attacker's script has to reach a deck's output, and then the operator has to
open that deck in the uploader. Nothing on another site can arrange that last
step:

- the session cookie is `SameSite=Strict`, so a cross-site link to `/` lands on
  the login page, not on an uploader holding a session. B4 measured this: a
  cross-site navigation to `/examples/embed.html?a=/d/<id>/` reached the server
  with no cookie and got 401. From the server's own site it did not get 401;
- `/examples/embed.html` is behind the token, because it frames whatever deck its
  query string names as soon as it opens;
- a third party framing `/d/<id>/deck.html` sends no cookie (B5).

What is left needs the operator to convert hostile content, for script to survive
into the deck, and for the operator to watch it in the uploader. `jobsPerHour`
still caps what that script can spend. The real fix is serving `/d/` from a
separate origin, which the `__Host-` cookie would never reach. That is the next
design, and it is not built.
