# hyperframes 0.8.27 → 0.8.31

Issue #70. Measured on 2026-09-09 in a worktree at
`~/.blackhole/DeckSmith/2026-09-09/hf-pin`, branch `chore/hyperframes-0.8.31`,
against a control captured earlier the same day at 0.8.27 with the pin untouched.

**Verdict: move the pin.** Every gate is green, every file DeckSmith emits is
byte-identical across the bump, and the one behavioural change that reaches the
renderer is upstream's deliberate frame-grid snapping. It is real and
confirmed, and it costs one frame per off-grid boundary. It does not touch the
demo deck at all, because that deck's boundaries are already on the grid. It
touches every narrated deck, and that is the caveat this document exists to
record.

The 2026-09-04 numbers (12 beats, 3120 frames, 166 differing, 83.90 dB) are
superseded. The deck is 15 beats and 4020 frames now. Nothing below is quoted
from an earlier document; every figure was taken from the command beside it.

---

## 1. The pin

| | declared | installed | `npx hyperframes --version` |
| --- | --- | --- | --- |
| before | 0.8.27 | 0.8.27 | 0.8.27 |
| after | 0.8.31 | 0.8.31 | 0.8.31 |

`git diff --stat` after `npm install hyperframes@0.8.31 --save-exact` shows
`package.json` and `package-lock.json` and nothing else. The lockfile diff is
the `hyperframes` entry alone — no transitive bump of `puppeteer-core` or
`@puppeteer/browsers`.

**The registry has already moved past this.** `npm view hyperframes dist-tags`
reads `latest: 0.8.33`, not the 0.8.31 the plan called latest. `upstream-drift.yml`
compares the pin to `npm view hyperframes version` as a literal string, so this
issue re-files next Monday regardless of what we do here.

## 2. What actually changed upstream

Verified by decompiling the 0.8.31 tarball, not taken on the plan's word. The
installed runtime hashes `c6f9f9b8e15360a2…`, identical to the tarball examined,
so the finding is about the code that is on disk.

The quantiser is `function $t(e,t)` at 0.8.27 and `mt(e,t)` at 0.8.31, the same
body both times:

```js
Math.floor(r * n + 1e-9) / n        // r = time, n = fps
```

What moved is where it is called.

| | call sites | on |
| --- | --- | --- |
| 0.8.27 | 5 | seek time only (`seek`, `renderSeek`, `Su`) |
| 0.8.31 | 7 | the same 5, plus **the element activation window** |

The two new ones:

```js
$  = window.__HF_EXPORT_RENDER_SEEK_CONFIG ? mt(w, e.canonicalFps) : w,
ue = window.__HF_EXPORT_RENDER_SEEK_CONFIG && Number.isFinite(re) ? mt(re, e.canonicalFps) : re;
return g >= $ && (Number.isFinite(ue) ? g < ue : !0)
```

`w` is the element's start, `re` its end. Both are floored to the frame grid,
and only when `__HF_EXPORT_RENDER_SEEK_CONFIG` is set — which only
`hyperframes render` sets. `lint`, `check`, `verify`, the deck player and
`decksmith frames` are all blind to it by construction, which is the shape
AGENTS.md is a list of.

The renderer seeks frame `k` to exactly `k/fps`, and the predicate is
`g >= start && g < end`. So each off-grid boundary value `v` moves its edge from
frame `ceil(v*fps)` to frame `floor(v*fps)` — **exactly one frame earlier, and
on-grid values do not move at all**, because flooring a value already on the grid
is the identity.

### The other two upstream changes are inert here

- **0.8.30's widened CSS scoper** now also rewrites
  `[data-composition-id^=|*=|$=]`. DeckSmith emits zero such selectors
  (`grep -rn 'data-composition-id[[:space:]]*[\^*$]=' src/ demo/ test/` — no
  matches), so it cannot bite.
- **`media_src_kind_mismatch`.** The plan said 0.8.31 "grows `<audio>` coverage".
  That is not what it does, and the difference matters. The rule is **absent at
  0.8.27** and at 0.8.31 still inspects only `video` and `img` tags:

  ```js
  if (tag.name !== "video" && tag.name !== "img") continue;
  ```

  What 0.8.31 adds is `AUDIO_SRC_EXT = {mp3, wav, aac, flac, opus, aiff, wma}` to
  the *extension* vocabulary. So `<video src="clip.m4a">`, which returned `null`
  (no finding) at 0.8.28–0.8.30, now classifies as kind `audio`, mismatches the
  expected `video`, and fails `check` at **severity error**. DeckSmith emits
  exactly one `<video>`, at `src/emit/archetypes/claim-figure.ts:183`, and never a
  literal `<audio src>` — the only audio element is built by JS at
  `src/deck/runtime.ts:566`. See §8 for why this is untested.

## 3. Gates

Run `npm run build` **before** `npm run check` — `check` does not build, and will
pass over a stale `dist/`.

| gate | control 0.8.27 | 0.8.31 |
| --- | --- | --- |
| `npm run build` | exit 0 | exit 0 |
| `npm run check` | exit 0, 46 files, 1602 tests | **exit 1 on the first run**, then exit 0, 46 files, 1602 tests |
| `npm run sweep` | not run (pin had not moved) | 45 ok, 8 refused over 53 cells in 64.0s |

**The one red gate, and it is the receipt working correctly.**
`experiments/sweep/swept.test.mjs` failed with the ledger holding
`9b786a0c9eb6061e` against a computed `d55f243c08d3036b`.
`toolFingerprint()` in `scripts/score.mjs:224` folds `package.json`'s
`dependencies` into the hash on purpose, so **any** pin change invalidates the
sweep receipt by design. Re-earning it with `npm run sweep` is the correct
response, and it is a step every future bump needs.

What the re-run proves is worth more than the green tick: the ledger diff is
**two lines, `tool` and `updated`**. All 53 cell verdicts and all 11 corpus
entries are byte-identical at the new pin — 11/11 known defects still fixed, 0
still open, 42 other cells undefective.

## 4. What the build emits

| | control 0.8.27 | 0.8.31 |
| --- | --- | --- |
| verdict | `PASS — 0 error(s), 9 warning(s)` | `PASS — 0 error(s), 9 warning(s)` |
| duration / scenes / holds | 134s / 15 / 46 | 134s / 15 / 46 |
| `timing.json` | 2501 B | 2501 B |
| `deck.html` | 22688 B | 22688 B |
| `index.html` | 96416 B | 96416 B |

`timing.json`, `deck.html` and `index.html` are **byte-identical across the pin**
by sha256. Invariant 7 holds: `deck.html` contains no `data-composition-id`.

Vendored files: `gsap.min.js`, `katex.min.js`, `DrawSVGPlugin.min.js` and
`ds-morph.js` are byte-identical. `hyperframes-player.global.js` differs, and
differs **only** in the version inside its jsDelivr url —
`@hyperframes/core@0.8.27` → `@hyperframes/core@0.8.31`, 64037 bytes either way,
identical after normalising that string. Exactly one vendored file changed, which
is what was predicted; a second one would have been a finding.

## 5. `hyperframes check`

`ok: true` at both pins, 0 errors at both, `totalIssueCount: 23` at both,
contrast 62 checked / 62 passed with sample times
`[7.444, 37.222, 67, 96.778, 126.556]` at both.

Two differences, neither a verdict change:

- **One finding moved severity.** Layout goes from 10 warnings + 13 infos to
  9 warnings + 14 infos. The single moved finding is at **t=57.045s**,
  `content_overlap`, demoted warning → info by upstream.
- **Selector naming changed**, from class-based to id-anchored structural paths:

  | control | 0.8.31 |
  | --- | --- |
  | `span.w` | `#s1-t > span:nth-of-type(1)` |
  | `span.mclose` | `div.ds-morph-layer > span:nth-of-type(8)` |
  | `span.mrel` | `div.ds-morph-layer > span:nth-of-type(11)` |
  | `span.mord.mathcal` | `div.ds-morph-layer > span:nth-of-type(12)` |

**This is a live coupling and it deserves a look.** DeckSmith parses a scene id
out of that string in two places — `src/verify/check.ts:364`
(`/#(s\d+)\b/.exec(selector)`, which decides whether a mid-camera-move excuse is
scoped to the right scene) and `scripts/sweep.mjs:436`
(`/#s(\d+)\b/.exec(f.message)`, which maps a finding to a beat). Upstream
reformatting a diagnostic string can therefore change DeckSmith's own grading.
Here it did not: `regrade` only fires for `OFF_CANVAS = {canvas_overflow,
panel_out_of_canvas, text_occluded}` and every selector that changed belongs to a
`content_overlap`. So the coupling is real but latent on this deck. A guard is
worth more than a fix right now.

## 6. Stepping the deck

`scripts/seek-probe.mjs`, which drives the host bridge — the shipped consumer
path — rather than `player.seek()`, which legitimately moves nothing.

| | stops | island agrees | transitions | moved | scenes | ever moved | distinct fingerprints | page errors | pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control 0.8.27 | 46 | yes | 45 | 45 | 16 | 16 | 46 | 0 | true |
| 0.8.31 | 46 | yes | 45 | 45 | 16 | 16 | 46 | 0 | true |

Identical row. The step layer in `src/deck/` is unaffected.

## 7. The flooring change, measured

**The demo deck cannot see it.** Every `data-start` and `data-duration` the
silent composition carries is an exact multiple of 1/30 — integer seconds
0, 6, 16, 25, 34, 43, 52, 61, 70, 79, 88, 97, 106, 115, 125 — so 0 of its 30
scene boundaries and 0 of its 32 element-window boundaries are eligible to move.
The control wrote that prediction down before any render
(`prediction-step0.3.txt`), and the byte-identical `index.html` in §4 is the same
fact from the other side. A green comparison on this deck is **not** evidence
about the flooring change, and the cross-pin comparator prints that caveat in its
own output rather than leaving it to be assumed.

The narrated deck is where it bites: 29 of its 30 boundaries are off-grid.
Narration is what pushes boundaries off the grid.

### So an off-grid fixture was built to see it

Two beats with fractional `seconds`, no narration, off the `plain` source — which
was authored so its two renders are byte-identical, giving a **zero-noise**
instrument. Recreate it with:

```bash
sed -e 's/"seconds": 3$/"seconds": 3.017/' -e 's/"seconds": 4$/"seconds": 4.051/' \
  demo/fixtures/plain.storyboard.json > offgrid.storyboard.json
node dist/cli.js build offgrid.storyboard.json \
  --source demo/fixtures/plain.source.json --no-narration -o deck-offgrid
```

Duration 7.068s, 2 scenes, 213 frames. Element windows: `root` [0, 7.068],
`s1` [0, 3.417], `s2` [3.017, 7.068]. Three boundary values are off the grid.

**Prediction, written before any render** (`prediction-offgrid.txt`): each
off-grid boundary contributes exactly one differing frame at `k = floor(v*30)`,
so frames **k = 90, 102 and 212** differ and nothing else does.

**Measured: 2 of the 3.** Frames **102 and 212** differ. Frame 90 did not.

| | frames | identical | differing | worst |
| --- | --- | --- | --- | --- |
| own noise, 0.8.27 (two renders) | 213 | 213 | 0 | — |
| own noise, 0.8.31 (two renders) | 213 | 213 | 0 | — |
| **cross-pin** | 213 | 211 | **2** | **10.94 dB** |

Frame 103 measures 15.64 dB and frame 213 measures 10.94 dB, both far below the
40 dB floor. These are not subtle: a whole scene is missing.

**The prediction was wrong and it is not being adjusted to fit.** The mechanism
was right and the eligible set was right; the assumption that every eligible
boundary yields a differing *frame* was wrong. Every one of the three boundaries
does move its activation edge — the code floors unconditionally — but a moved
edge only becomes a moved pixel when the element is visible at that instant.
Frame 90 is scene `s2`'s **start**, and every child of `s2` is
`fromTo("#s2-…", {opacity: 0, …}, …)` at an offset into the scene, so at its own
start instant the scene is entirely transparent. Activating the container a frame
early paints nothing. The two frames that did move are **end** boundaries, where
the scene is fully opaque and vanishing a frame early is stark.

Looked at rather than trusted: at frame 103 the 0.8.31 render has already torn
down scene `s1` — "Two renders, one hash" and its rule line are gone — while
0.8.27 still shows it mid-crossfade. Frames 102 and 104 match at both pins.

So the change ships as: **on any deck with off-grid boundaries, an outgoing scene
is torn down one frame earlier than it was at 0.8.27.** One frame, 33 ms, during
a crossfade. That is upstream's intended, more frame-accurate reading of "this
element is active from t".

### The disagreement this exposes

DeckSmith's retimer rounds — `src/render/timing.ts:523`, `f = s => Math.round(s*fps)`
— while the runtime now floors. On roughly half of all off-grid boundaries those
two disagree by a frame. That is a question about DeckSmith's own arithmetic, it
is independent of this bump, and it is the most useful thing this exercise found.
It deserves its own issue and a browser-free arithmetic test asserting the two
grids agree, which would have flagged 0.8.30 before any render ran.

## 8. Not measured

Recorded as explicitly as the measurements above.

- **The full-length cross-pin PNG comparison of the demo deck — the one step 4 of
  the task asked for — did not run.** It is blocked by an upstream disk
  preflight, not by anything about the pin. `assertDiskCaptureHeadroom` estimates
  `frames × width × height × 4` (uncompressed RGBA) and requires that to fit in
  90% of free space: 4020 × 1920 × 1080 × 4 = 33.3 GB, so **37.0 GB free is
  required** against **24 GB available**. Actual PNG usage is ~822 MB, so the
  estimate is ~40× pessimistic, but it throws hard. The control's own drift ran
  earlier the same day when more was free. `drift --keep` and `render` both fail
  identically. Nothing here is mine to reclaim — 5921 leftover `decksmith-*` temp
  dirs total 40 MB between them.
- **The 0.8.31 noise floor for the demo deck**, for the same reason. The control's
  0.8.27 floor (3852 of 4020 identical, worst 83.90 dB at frame 2475) is
  **inherited from the control run and was not re-measured here**; re-taking it is
  impossible now the pin has moved.
- **The narrated deck was not rendered at either pin.** It is the deck with 29 of
  30 boundaries off-grid, so it is precisely the deck that will show the one-frame
  teardown, and it is unverified. The off-grid fixture is that case in miniature
  and measured; the full narrated deck is not.
- **The mp4 comparison is confounded and is not evidence about the pin.** The
  0.8.31 render only completed by dropping to `-w 1`, which flips
  `useStreamingEncode` on and avoids the disk preflight entirely. So the control
  mp4 (auto = 4 workers, disk capture) and the 0.8.31 mp4 (1 worker, streaming
  encode) differ in worker count and capture path as well as pin. For what it is
  worth: 4020 frames both, 1920×1080, 30.000 fps, 134.00s, 0 narration segments;
  2639 of 4020 frames byte-identical after H.264, median 55.34 dB, worst 39.77 dB
  at frame 2715, 2 frames below 40 dB and none below 30. Frame 2715 inspected
  side by side is the same table with the same values and the same row
  highlighted. Three variables moved at once, so this bounds nothing.
- **`media_src_kind_mismatch` against a real clip.** No `.mp4`/`.webm` fixture
  exists anywhere in the repo and harvesting one needs the network. The static
  question is closed (§2) but the error-severity rule is unexercised, and the
  `--no-transcode` path is the one that can carry an arbitrary extension.
- **Nobody watched either mp4 end to end.** An 8-scene filmstrip from the 0.8.31
  render shows correct content throughout — title, method diagram, window grid,
  KaTeX, layer stack, comparison table, qualitative grid, closing panel, none
  blank or frozen or repeated — plus the worst frame inspected directly. That is
  sampling, not watching 2m14s.
- **0.8.32 and 0.8.33 were not examined at all.** Only 0.8.27 and 0.8.31.
- **`demo/deck-control/` and `demo/deck-new/` are untracked build output** left in
  the worktree deliberately, as the comparison baselines. An unrelated
  `git add -A` would sweep them in.

## 9. Recommendation

Take 0.8.31. The bump is clean everywhere DeckSmith can observe it, the one real
change is upstream's deliberate render-time frame snapping, and it costs one frame at an
off-grid scene edge.

Then, separately and not as a condition of this bump:

1. **A browser-free arithmetic test** asserting `src/render/timing.ts`'s
   `Math.round` grid against the runtime's `Math.floor(t*fps+1e-9)/fps`. It is
   cheap, needs no browser, and is the only guard here that would have caught
   0.8.30 before a render.
2. **A guard on the finding-selector coupling** in `src/verify/check.ts:364` and
   `scripts/sweep.mjs:436`, both of which parse a scene id out of a string
   upstream is free to reformat — and just did.
3. **Rewrite the "two renders byte-identical" requirement at its source** in
   `.github/workflows/upstream-drift.yml`. It is generated fresh every Monday, it
   has been wrong since 2026-09-04, and editing the issue does not fix it. Do not
   change the issue title or it files a duplicate alongside the old one.
4. **A clip fixture**, so the one `<video>` DeckSmith emits is exercised by
   something the repo owns.

## 10. Confidence

**High** on every number here; each was taken from the command printed beside it
and none was carried over from a document, with the single exception named in §8.
**High** that the flooring change is real and reaches the renderer — confirmed
twice, once by decompiling the installed tarball and once by a rendered
difference that can be seen. **High** that the demo deck is immune, by arithmetic
and by byte-identical output. **Medium** on the claim that this is harmless in
practice for narrated decks: the mechanism is understood and bounded to one
frame, but no narrated deck was rendered at 0.8.31, and that is the gap a
reviewer should weigh.
