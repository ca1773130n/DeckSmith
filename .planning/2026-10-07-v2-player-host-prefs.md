# v2 player: how a host keeps a viewer's playback preferences

2026-10-07. Branch `feat/v2-player`. This is the contract a page that embeds a v2 deck
(`--design v2`, or `decksmith repack`) uses to keep speed and captions per user. HypePaper is
the first host; its file and line references below were read at HypePaper `main` d1477362f.

## The deck's side (what ships)

Three preferences: `speed` (0.75, 1, 1.25, 1.5, 1.75, 2), `cc` (boolean), `ccsize`
(`s` `m` `l` `xl`). Defaults are 1, on and `m`. The deck resolves them in this order, and
later sources win:

1. defaults
2. `localStorage["decksmith.prefs.v1"]` on the deck's own origin
3. the URL: `deck.html?speed=1.25&cc=0&ccsize=l` (`cc` also takes on/off/true/false).
   The URL applies to that visit and is not saved.
4. a message from the parent: `{ type: "decksmith:prefs", speed?, cc?, ccsize? }`. Valid
   fields are applied and saved, and they are not echoed back.

When the viewer changes a preference with a button or a key, the deck saves it and posts
`{ type: "decksmith:prefs", speed, cc, ccsize }` to `parent` with target `"*"`. The message
carries only those three values: no position, no notes. It is not on the `decksmith-deck`
channel in `src/deck/protocol.ts`, because that channel stays silent until a `hello`
handshake, and a plain iframe never sends one. **The host must check `event.origin`.**

The deck's own `localStorage` cannot be the per-user store. In a cross-site iframe it is
partitioned by top-level site, it belongs to a browser and not to an account, and the host
cannot read it. That is why the deck posts the change up to the host.

## HypePaper today

- `PaperDetailPage.vue:2159-2167` embeds `slideDeckUrl` (`…/deck.html`) in a plain
  `<iframe sandbox="allow-scripts allow-same-origin" allow="autoplay">`. postMessage works
  in both directions under that sandbox.
- The briefing player does **not** persist its speed. `BriefingAudioPlayer.vue:162` has
  `const speed = ref(1)`, so every mount starts at 1×. `cycleSpeed` (`:218`) walks
  `[0.75, 1, 1.25, 1.5, 2]` and sets `playbackRate` live. The live part is what the deck now
  matches. Remembering the speed is new for both players.
- A per-user store already exists: `PUT /api/profile/me/preferences` with `merge: true`
  (`backend/src/features/profile/profile_routes.py:373`), called through
  `profileApi.updatePreferences` (`frontend/src/features/profile/api.ts:104`). The column
  is free-form JSONB, so no migration is needed.

## What to change in HypePaper (proposed, not done)

1. **Add one store for both players.** Create `usePlaybackPrefs()` holding
   `{ speed, cc, ccsize }`:
   - Signed in: read from `profile.preferences.playback`, and write with
     `profileApi.updatePreferences({ preferences: { playback }, merge: true })`.
   - Anonymous: use `localStorage["hp.playback"]`, wrapped in try/catch the way
     `core/theme.ts:26` does it.
   - `BriefingAudioPlayer` reads its initial `speed` from this store and writes it back in
     `cycleSpeed`. That gives the founder's "like the briefing" behaviour in both
     directions.
2. **Pass the preferences in.** Build the iframe `src` once, when the deck mounts:
   `slideDeckUrl + ?speed=…&cc=1|0&ccsize=…`. The src must not be reactive to the store,
   because changing it reloads the deck and restarts it from slide 1. Use the same query
   on the "Open fullscreen" link (`:2120`).
3. **Save what the viewer changes:**
   ```ts
   const deckOrigin = new URL(slideDeckUrl.value).origin
   function onDeckPrefs(e: MessageEvent) {
     if (e.origin !== deckOrigin || e.data?.type !== 'decksmith:prefs') return
     playback.save({ speed: e.data.speed, cc: e.data.cc, ccsize: e.data.ccsize })
   }
   onMounted(() => addEventListener('message', onDeckPrefs))
   onBeforeUnmount(() => removeEventListener('message', onDeckPrefs))
   ```
4. **Optional:** if the store changes while a deck is open (for example, the user changes
   the briefing speed in another tab), send
   `iframe.contentWindow.postMessage({ type: 'decksmith:prefs', ...prefs }, deckOrigin)`.
5. **Point `deck_url` at `deck2.html`** once the founder approves the repacked decks. Leave
   `deck.html` in place (the no-delete rule). `slideDeckUrl` already passes a URL ending in
   `.html` through unchanged (`PaperDetailPage.vue:5083`).

## Not settled

- Safari's partitioning of the deck's own storage has not been tested. It only affects the
  anonymous fallback inside the deck, not the host-side store above.
- Nothing is released, and the HypePaper deck worker stays stopped until the founder has
  seen the v2 decks and confirmed.
