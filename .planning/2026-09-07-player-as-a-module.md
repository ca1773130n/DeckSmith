# The player as a module, and a genre control

**Date** 2026-09-07. Nine agents: four mapping the current boundary, three
proposing designs, two judging on reusability and on breakage. Both judges
converged, and both rejected the design that looks most like what was asked for.

## The verdict: promote the iframe, do not dissolve it

`<decksmith-player deck="/decks/foo/">`, an ESM custom element, talking to the
deck through `postMessage`. The iframe stays and BECOMES the module boundary
rather than being replaced by one.

**The rejected design** was the tempting one: extract `runtime.ts` into the host
page so the deck mounts inline, no iframe. Three structural facts kill it, all
verified in the tree rather than argued:

1. **Origin.** `frameOf` (runtime.ts:200-215) reads `contentDocument` and
   `contentWindow.__timelines`, returns null cross-origin, and `start` only
   warns (:773). Extracting transplants that same-origin requirement onto
   host↔deck, so a third party serving decks from a CDN gets a deck that
   navigates perfectly and paints nothing — silently, because `paint` just does
   nothing. Keeping the frame leaves the same-origin pair as deck.html↔index.html,
   the same directory, always true.
2. **Registry.** `customElements.define` is one per document and throws on a
   duplicate. Hosting `<hyperframes-player>` in the app shell means two decks
   from two jobs are two vendored bundles and the second define throws.
3. **CSS.** `.ds-chrome{position:fixed;z-index:2147483000}` (:269), `.ds-cap`
   toggled on documentElement (:403), `.ds-cap hyperframes-player{height:calc(100vh
   - var(--ds-cap-h))}` (:315). Inside the iframe `100vh` IS the box, so these
   are right for free. In a host page every one is wrong, and wrong quietly — a
   mis-sized slide, not an error.

It also fails the reusability test it was supposed to win. To host the player
the consumer's module must inject our vendored hyperframes bundle into their
registry and `fetch` + `DOMParser` the island out of our HTML — so the consumer
hard-codes our island format and our emit shape. That is the definition of
requiring them to know about hyperframes, the island, and our build.

With the frame kept, a third party learns **one thing**: a deck URL.

## What the mapping found about `runtime.ts`

Two halves with a hard seam. Lines 33-171 are pure, exported and unit-tested —
`buildStops`, `planTransition`, `formatHash`, `parseHash`, `findStop`. Lines
173-786 are one closure, `async function start(doc)` at :542, not exported, no
return value, no events out, no teardown.

It self-boots at :780-786 with a bare top-level statement. That is why the
inlined IIFE works and why it is not a module.

Things a real extraction would have to fix, none of which the chosen design
needs to touch:

- Seven ambient globals resolved on the window rather than on `doc` — rAF,
  setTimeout, matchMedia, history, location, bare addEventListener, console.
  `start` politely takes `doc` and then ignores it for all seven.
- No `dispose()`. Two keydown, two click, hashchange, the audio `ended`
  listener, two rAF loops and a dwell timeout all outlive any unmount.
- Every class name global and unprefixed, so two players in one document collide.
- `audioSrc` returns a path relative to the document that owns the audio element.
  Move it to a host page and every segment 404s — misreported, because the
  handler at :494-506 conflates "autoplay refused" with "file missing".

## A latent bug found on the way, unrelated to the request

`runtime.ts:765` assigns `frame = frameOf(player)` **once**, and `frameOf`
captures `win.__timelines ?? {}` at that instant. If the composition's scene
scripts have not run yet, the runtime holds a frozen empty object: `paint` still
toggles `display`, but `frame.timelines[sceneId]?.seek(...)` no-ops forever. The
deck navigates perfectly and shows every scene at its `from` state.

Today the ordering saves it — DOMContentLoaded inside deck.html, then
`whenReady`, by which point the composition has registered. It is a race that
has not fired, not a race that cannot. **Re-read `contentWindow.__timelines` at
paint time instead of snapshotting it.** Two lines.

## The build order

Each step ships on its own.

1. **Genre control, alone.** Markup after ui.ts:701 copying the tone/density
   pattern; `paintSeg("genre", ["general","paper"], "general")` after :1634.
   `.row` is `auto-fit minmax(210px,1fr)`, so a third column reflows. It needs a
   hint line more than the others do, because "paper" is not self-explanatory.
2. **`"deck-runtime": "dist/deck-runtime.js"` into `promised`** at
   scripts/build.mjs:118. One line, no behaviour change, and it closes a standing
   blind spot before anything relies on that assertion.
3. **The bridge, inert.** `src/deck/protocol.ts` for the message union, imported
   by both ends so `tsc` checks them against each other, plus ~25 lines inside
   `start()`: a `message` listener guarded on `e.source === parent`, the origin
   captured from a `ds:hello`, and a post at the tail of `go`.
4. **The module and its packaging, unused.** `src/deck/player.ts` (class plus a
   guarded, tag-parameterised `define()`, no top-level side effect) and
   `src/deck/player-element.ts` (two lines: import define, call it). Two esbuild
   calls spreading `shared`, not `node`.
5. **The route and the UI rewire, behind a feature detect.**
   `GET /player.js` beside `/api/formats`; in `mount()`'s deck branch,
   `customElements.get("decksmith-player")` present → the element, absent →
   today's iframe code verbatim.
6. **The demo page**, outside any deck directory, with two players on it.

## The risks, and the one that matters most

**Nothing gates any of this.** `test/deck.test.ts:36-38` says so outright and
`src/verify/index.ts:971-985` enforces it by filtering `DECK_PAGE` out of the
composition scan. Steps 3-6 ship green through lint, check, verify, drift,
render and the type floor whether they work or not. **A browser pass is the
verification, and it is not optional.**

Others, recorded:

- **Invariant 7 is guarded by a hardcoded two-file list.** `test/deck.test.ts:26`
  scans `["runtime.ts","subtitles.ts"]` for the literal, so a new
  `protocol.ts` is silently exempt. Extend the list in the same commit.
- **deck.html's bytes move** on every navigable deck built after step 3, by the
  minified size of the bridge.
- **Speaker notes cross a realm boundary.** A stop carries `notes`, and any page
  can frame a deck. Posting to `"*"` hands presenter notes to an arbitrary
  framer. Capture the origin from the handshake and use only that.
- **The bridge is version-coupled**, and every deck published at 0.3.1 lacks it.
  The module must treat silence as supported: time out the way `whenReady` does,
  emit a distinct error, and keep the deck usable.
- **The manifest-promise assertion never reads `exports`**, so a new subpath can
  name a file the build does not produce with every gate green. Defer the
  `exports` entry until after the browser pass.

## Cut from the first cut

The whole runtime extraction: the injected `win`, the flags, the in-page
`hyperframes-player`, `dispose()`, threading a base URL through `audioSrc`. It
rewrites the one file every navigable deck inlines, in exchange for benefits
that land only in the preview pane, and no gate can tell you whether it worked.

If the boundary is in the right place, that refactor is later invisible to
consumers behind the same element API. Put it there and find out cheaply.
