# hyperframes 0.8.27 → 0.8.31

Issue #70. Measured on 2026-09-09 in a worktree at
`~/.blackhole/DeckSmith/2026-09-09/hf-pin`, branch `chore/hyperframes-0.8.31`,
against a control captured earlier the same day at 0.8.27 with the pin untouched.

**Verdict: move the pin, and know what it costs.** Every gate is green, every
file DeckSmith emits is byte-identical across the bump, and the one behavioural
change that reaches the renderer is upstream's deliberate frame-grid snapping.
It is real and confirmed, and it costs one frame per off-grid boundary. It does
not touch the demo deck's *flooring*, because that deck's boundaries are already
on the grid. It touches every narrated deck.

**Both of that paragraph's caveats were closed on 2026-09-10 and both answers
were more interesting than expected — see §7a and §7b.** The narrated deck's
**last frame renders blank** at 0.8.31, and the silent deck — the one predicted
to be immune — **differs across the pin anyway**, for a second reason that is
not the flooring change. Neither is a reason to hold the bump. Both are reasons
not to describe it as invisible.

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
own output rather than leaving it to be assumed. *(2026-09-10: the comparison on
this deck came back RED, and a red one is not evidence about the flooring change
either — §7a.)*

The narrated deck is where it bites. This paragraph used to read "29 of its 30
boundaries are off-grid"; re-counted on 2026-09-10 on the deck built that day it
is **30 of 32** — 16 elements carry a window, and only `root:start` and
`s1:start`, both exactly 0, are on the grid. They collapse to 29 distinct
candidate frames because `root:end` and `s15:end` are the same value.
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

---

## 7½. 2026-09-10: how the two caveats were closed

Everything from here down was measured on 2026-09-10 in this same worktree.
Method notes, because both have bitten this project before:

- **`demo/audio/` was COPIED into the worktree** from the main checkout
  (`cp -R`, original untouched). It is gitignored, so it does not show in
  `git status`. Without it the narrated build is silently a silent build, and
  the resulting duration difference has already once been mistaken for a
  regression.
- **Both sides of every comparison used identical settings**: `-w 1`, and for
  the narrated deck `PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS=600`. The
  env var's default is `240` at **both** pins (checked in each tarball's
  `dist/cli.js`), so raising it puts both on the same streaming-encode path
  rather than one on streaming and one on disk capture. That was the confound
  that made yesterday's mp4 comparison bound nothing.
- **`-w 1` alone does NOT bypass the disk preflight**, and §8 used to say it
  did. It only turns streaming encode on for compositions under
  `streamingEncodeMaxDurationSeconds`. The 265.81s narrated deck at `-w 1` fails
  the preflight exactly like everything else: *"Disk capture may need ~66147.8 MB
  … only 19075.8 MB is free"*. The silent deck is 134s, under the 240s gate, and
  therefore streams.
- **Predictions were written to
  `~/.blackhole/DeckSmith/2026-09-10/predictions/2026-09-10-predictions.txt`
  before the renders that test them**, from arithmetic re-taken on the decks
  built that day, and are reported below unadjusted — including the three that
  failed.

### 7a. Caveat one, closed: the null control

The silent deck (`--no-narration` passed explicitly), built and rendered at both
pins with identical settings. Boundary arithmetic re-taken on the deck built
that day: **16 elements carry a window, 32 boundaries, 0 off-grid.** Every
`data-start`/`data-duration` is an integer second or a multiple of 0.4s.
Flooring is the identity on all 32. So no frame is eligible to move, and the
prediction was zero difference.

**The noise floor is zero at both pins.** Two renders of the silent deck at
0.8.31 are byte-identical (sha256 `141820428efcaf13…`, both 19 654 474 B); two
at 0.8.27 likewise (`f41c848ddbb205bb…`, both 19 625 822 B). *This corrects a
standing claim.* AGENTS.md invariant 11 says "this deck is not byte-identical to
begin with"; at `-w 1` with streaming encode it is, exactly, at both pins. That
claim was about `drift --identical` over PNG frames at default workers, which is
a different capture path — it is not wrong, it is not about this instrument.

**The cross-pin comparison is NOT null, and that is the finding.**

| | frames | identical | differing | worst |
| --- | --- | --- | --- | --- |
| noise floor, 0.8.27 (two renders) | 4020 | 4020 | 0 | — |
| noise floor, 0.8.31 (two renders) | 4020 | 4020 | 0 | — |
| **cross-pin, 0.8.27 vs 0.8.31** | 4020 | 3701 | **319** | **39.77 dB @ 2714** |

With a zero noise floor, all 319 are attributable to the pin. But 319 is the
count of frames that *decode* differently, not the count that carry a different
picture: the differing frames are one contiguous run, 2681..2999, ending one
frame before the keyframe at 3000, and only **8** of them are below 52 dB:

```
2714:39.77  2715:41.64  2716:44.26  2717:48.48
2750:39.82  2751:42.08  2752:45.64  2753:50.85
```

The other 311 sit between 52 and 70 dB and are H.264 rate-control divergence
propagating from those 8 — the encoder is deterministic given identical input,
and stops agreeing once one input frame differs. **Every frame count taken from
an mp4-vs-mp4 comparison in this document is inflated the same way, by roughly
40×.** That is the price of comparing mp4s instead of PNGs, and it is worth
paying at 17 GB free; it is not a reason to trust the raw counts.

#### What the 8 frames are, looked at rather than inferred

Frames 2714 and 2750 are the first frames of the deck's only two `fontWeight`
tweens, both on scene `s11`'s comparison table:

```js
tl.fromTo("#s11-r3 td", {color:"#9aa7b5", fontWeight:400}, {color:"#7cc4ff", fontWeight:600, duration:0.5}, 2.45);
tl.fromTo("#s11-r4 td", {color:"#9aa7b5", fontWeight:400}, {color:"#f78da7", fontWeight:600, duration:0.5}, 3.65);
```

`s11` starts at t=88, so those land at t=90.45 and t=91.65 — frames 2713.5 and
2749.5. Side by side at frame 2714, the `CATANet` row is emphasised at 0.8.27
and still plain at 0.8.31; both agree again by frame 2718. Mean luma of that row
band, frames 2708..2726:

```
0.8.27  35.80 ×6 | 37.50 37.65 37.80 37.92 | 38.09 38.46 38.89 39.22 …
0.8.31  35.80 ×6 | 36.09 36.64 37.17 37.65 | 38.10 38.46 38.91 39.23 …
```

0.8.31 ramps smoothly out of 35.80 from the tween's own start instant; 0.8.27
**steps** +1.70 on the tween's first frame and then creeps until it rejoins.
Read that way 0.8.31 is the more faithful of the two, not the regression — but
that is an inference from the shape of one ramp, so: **medium** confidence, and
the upstream cause is NOT MEASURED (see §8).

This is not the flooring change. All 32 boundaries are on the grid, and
`index.html` — the file `hyperframes render` loads — does not reference
`hyperframes-player.global.js`, the one file that differs between the two built
deck directories. It is a second, independent behavioural change somewhere in
0.8.28–0.8.31.

**So the sentence "a green comparison on this deck is not evidence about the
flooring change" needs its converse: a RED comparison on this deck is not
evidence about the flooring change either. It was red, and for another reason.**

### 7b. Caveat two, closed: the narrated deck

Built with `demo/audio/` present, at both pins, byte-identical `index.html`,
`deck.html` and `timing.json` across the pin (§4's finding, re-taken on this
deck). Composition duration **265.81s at 30fps**; the capture is **7975 frames**,
`ceil(7974.3)`, which was predicted before the render.

Boundary arithmetic re-taken on the deck built that day: **32 boundaries, 30
off-grid** — only `root:start` and `s1:start`, both exactly 0, survive. That
yields **29 distinct candidate frames** at `k = floor(v*30)`, 14 scene starts,
14 scene ends, and `k=7974` where `root:end` and `s15:end` coincide.

One pipeline fact makes frame indices comparable at all, and it is worth
recording because it contradicts the retimer trap at the top of AGENTS.md:
`framePlan` (`src/render/timing.ts`) now emits `freeze: 0` for **every** piece,
narrated or not — the comment block there explains why — so `retime` returns the
raw capture untouched and `mux` uses `-c:v copy`. The narrated mp4's video
bitstream IS the hyperframes capture. Source frame *k* is output frame *k*.

**The narrated noise floor is not zero, and it bounds everything below.** Two
renders of the narrated deck at 0.8.27 differ in **324 of 7975** frames, worst
**60.87 dB**, nothing below 60. Every cross-pin figure below beats that by
20–50 dB.

| | frames | identical | differing | worst |
| --- | --- | --- | --- | --- |
| noise floor, 0.8.27 (two renders) | 7975 | 7651 | 324 | 60.87 dB |
| **cross-pin, 0.8.27 vs 0.8.31** | 7975 | 3568 | **4407** | **9.59 dB @ 7974** |

4220 of the 4407 are worse than anything the noise floor produced. As in §7a,
almost all of that is H.264 propagation: **13 frames are below 40 dB, 3 below
30, 1 below 20.**

#### Predicted vs measured, both directions

**Scene ENDS — predicted to differ, all 14 did.**

| scene | k | predicted ghost opacity | measured |
| --- | --- | --- | --- |
| s1 | 297 | 1.99% | 45.65 dB |
| s2 | 945 | 15.36% | 33.75 dB |
| s3 | 1926 | 11.64% | 35.54 dB |
| s4 | 2620 | 3.31% | 38.73 dB |
| s5 | 3105 | 9.75% | 36.68 dB |
| s6 | 3420 | 5.91% | 41.76 dB |
| s7 | 3819 | 1.00% | 57.57 dB |
| s8 | 4481 | 9.43% | 37.06 dB |
| s9 | 5062 | 11.95% | **24.16 dB** |
| s10 | 5383 | 4.29% | 42.18 dB |
| s11 | 6019 | 2.32% | 49.56 dB |
| s12 | 6342 | 8.80% | 38.95 dB |
| s13 | 6799 | 13.82% | **28.00 dB** |
| s14 | 7611 | 6.88% | 39.80 dB |

The opacity column was computed before the render, from
`1-(1-r/12)²` with `r = frac(v*30)` — every scene here fades ITSELF out with a
0.4s `power2.in` on the container, so the candidate end frame catches the
outgoing scene near the end of its own fade rather than solid. Spearman ρ
between the predicted opacity and the measured PSNR is **-0.934**: the
mechanism predicts not just which frames move but how hard.

**Prediction P-B3 failed on one clause and it is left standing.** It said "none
falls below 30 dB". Two do — s9 at 24.16 and s13 at 28.00 — because a ghost's
opacity is not the whole story: s9's outgoing slide is a full-width figure panel
on a near-white card, so 12% of it is worth more than 15% of a text slide. The
clause that named which frames would be worst ("one of k=945 / k=6799 / k=5062")
was right; all three are the three worst ends.

**Scene STARTS — predicted NOT to differ. 9 of 14 held, 5 did not.**

| k | scene | measured |
| --- | --- | --- |
| 285, 933, 1914, 2608, 3093, 3807, 5050, 6330, 6787 | s2,s3,s4,s5,s6,s8,s10,s13,s14 | **byte-identical** |
| 3408 | s7 | 59.21 dB |
| 4469 | s9 | 41.15 dB |
| 5371 | s11 | 41.02 dB |
| 6007 | s12 | **32.88 dB** |
| 7599 | s15 | 45.24 dB |

The reasoning behind the prediction — `.scene` has no background of its own and
every child enters through `fromTo({opacity:0},…)`, so a container activated one
frame early paints nothing — holds for nine scenes and fails for five, and the
write-up predicted exactly this failure mode in P-B6: "if any scene turns out to
have a child with no opacity-0 entry, its start frame will move". Looked at,
frame 6007 is that sentence made visible: at 0.8.31 scene `s12`'s **chart
chrome** — the `PSNR-Y (dB)` axis label, the 28/29/30/31 gridline numbers, the
`T=0 … T=4` ticks and `thought ticks` — is painted straight over the still-solid
s11 table, because the SVG axis is static furniture that no entry tween ever
touches. At 0.8.27 the table is clean.

**Moved but unpredicted: 8 frames.** `5445..5448` and `5481..5484`, at scene
`s11` local 2.458s and 3.658s — the *same two `fontWeight` tweens* as §7a, the
only two in either deck, reproducing in the narrated deck at the corresponding
frames. Nothing else outside the candidate set is below 45 dB.

#### The worst frame in the whole comparison, and the one that matters

**Frame 7974 — the last frame of the video — is blank at 0.8.31. 9.59 dB.**
`s15` is the only scene that does not fade itself out, because the composition
ends under it. Both `root:end` and `s15:end` are 265.81s; both floor to 265.8s;
frame 7974 seeks to exactly 265.8s; and `g < ue` is false for both. The entire
composition is torn down. Side by side: at 0.8.27 the closing slide — "A carrier
that survives every tick is enough to compete", the takeaway panel, Figure 4 —
at 0.8.31 the background and nothing else.

This was predicted (P-B4) and it is the one behaviour here that a viewer will
actually notice, because it is where the eye is when the video stops. It costs
33 ms and it affects **any deck whose duration is off the frame grid**, which is
every narrated deck.

Side-by-side frames are in `~/.blackhole/DeckSmith/2026-09-10/frames/`
(`sbs-narr-7974.png`, `sbs-narr-6007.png`, `sbs-narr-5062.png`,
`sbs-silent-2714.png`; 0.8.27 on the left of the yellow rule).

## 8. Not measured

Recorded as explicitly as the measurements above.

- ~~The full-length cross-pin comparison of the demo deck did not run.~~
  **Closed 2026-09-10 — see §7a.** Not by PNG sequence, which still does not fit
  (a 1080p PNG sequence of the silent deck is ~33 GB and of the narrated deck
  ~66 GB against ~17 GB free), but mp4-to-mp4 through ffmpeg's `psnr` filter,
  which costs two video files and a text log. The cost of that substitution is
  stated where it bites: H.264 rate-control divergence inflates the
  differing-frame count by roughly 40×, so the counts bound the *decoded video*
  and the sub-52 dB frames bound the *content*.
- ~~The 0.8.31 noise floor for the demo deck.~~ **Closed 2026-09-10 — see §7a.**
  Measured at both pins and both are ZERO: two renders at the same pin, at
  `-w 1`, are byte-identical. The 0.8.27 figure inherited from the earlier
  control run (3852 of 4020 identical, worst 83.90 dB at frame 2475) was taken on
  a different capture path and does not describe this instrument.
- ~~The narrated deck was not rendered at either pin.~~ **Closed 2026-09-10 —
  see §7b.** Rendered at both, identical settings, plus a second 0.8.27 render
  for its own noise floor.
- ~~The mp4 comparison is confounded.~~ **Closed 2026-09-10.** Both sides now use
  `-w 1` and, for the narrated deck, the same
  `PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS=600`, so the pin is the only
  variable. Yesterday's silent-deck figure survives the correction almost
  exactly — worst 39.77 dB at frame 2714 (0-indexed), the same frame — which
  means the worker-count confound was never what produced it. Yesterday's
  "2639 of 4020 identical" was the confound; the controlled number is 3701 of
  4020.
- **Why the silent deck differs across the pin at all is NOT MEASURED.** §7a
  localises it to 8 frames at the deck's only two `fontWeight` tweens and shows
  0.8.31's ramp is the continuous one, but no bisect across 0.8.28 / 0.8.29 /
  0.8.30 was run and no upstream code path was identified. Three renders
  (~8 minutes) would name the version.
- **`media_src_kind_mismatch` against a real clip.** No `.mp4`/`.webm` fixture
  exists anywhere in the repo and harvesting one needs the network. The static
  question is closed (§2) but the error-severity rule is unexercised, and the
  `--no-transcode` path is the one that can carry an arbitrary extension.
- **Nobody watched any of the five mp4s end to end.** Six frames have now been
  inspected side by side at both pins — the worst frame of each deck plus the
  four described in §7a/§7b — and an 8-scene filmstrip from the earlier 0.8.31
  render showed correct content throughout. That is sampling, not watching
  2m14s and 4m26s.
- **The narrated deck's audio and subtitles were not compared across the pin.**
  Only the video stream was. The two 0.8.27 narrated mp4s are not
  byte-identical while their video streams differ only at 60+ dB, so something
  in the AAC encode or the container is itself non-reproducible; that was not
  chased.
- **0.8.32 and 0.8.33 were not examined at all.** Only 0.8.27 and 0.8.31.
- **`demo/deck-control/` and `demo/deck-new/` are untracked build output** left in
  the worktree deliberately, as the comparison baselines. An unrelated
  `git add -A` would sweep them in. `demo/audio/` was copied in on 2026-09-10 and
  is gitignored.

## 9. Recommendation

Take 0.8.31 — the recommendation is unchanged by 2026-09-10's measurements, but
its justification is narrower than it was. The bump is clean everywhere
DeckSmith's gates can observe it, and the flooring change is upstream being more
frame-accurate, not less. What it costs, now measured rather than reasoned about:

- **the last frame of every off-grid deck goes blank** (§7b, 9.59 dB) — 33 ms,
  at the moment the viewer is looking at the end card;
- **an outgoing scene is torn down one frame early** at all 14 scene ends, worst
  24.16 dB, magnitude predicted to ρ = -0.934 by how far through its own fade
  the scene was;
- **an incoming scene's static furniture paints one frame early** at 5 of 14
  scene starts, worst 32.88 dB — chart axes over the previous slide's table;
- **8 frames move on the silent deck too**, for a reason that is not the
  flooring change and has not been traced upstream (§7a, §8).

**The blank last frame is the one worth acting on**, and DeckSmith can fix it
without upstream. The narrated deck's duration is 265.81s — `265.81 × 30 =
7974.3`, off the grid only because narration timing put it there. Rounding the
composition's total duration up to a whole frame (265.8333…s) would put
`root:end` and the last scene's end back on the grid, where flooring is the
identity. That is one line, in the same arithmetic §7's "disagreement" paragraph
is about.

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
5. **Snap the composition's total duration to a whole frame**, which removes the
   blank last frame entirely and costs at most 33 ms of black at the end of a
   scene nobody is watching for.
6. **A cross-pin render check that does not need 33 GB.** Two `-w 1` renders and
   `ffmpeg -lavfi psnr` cost about six minutes and 40 MB for the silent deck.
   The right threshold is the sub-52 dB set, not the raw differing-frame count,
   for the reason §7a gives. Both pins render byte-identically to themselves at
   `-w 1`, so the instrument has no floor to subtract.
7. **Bisect 0.8.28 / 0.8.29 / 0.8.30 for the `fontWeight` change** in §7a. Three
   renders. Until then the silent deck's 8 moved frames have a measurement and
   no cause.

## 10. Confidence

**High** on every number here; each was taken from the command printed beside it
and none was carried over from a document, with the single exception named in §8.
**High** that the flooring change is real and reaches the renderer — confirmed
twice, once by decompiling the installed tarball and once by a rendered
difference that can be seen.

Revised 2026-09-10:

- **High** that the demo deck is immune *to the flooring change*, by arithmetic
  (0 of 32 boundaries off-grid on the deck built that day) and by byte-identical
  build output. **Not** immune to the bump: §7a.
- **High**, no longer medium, on what this costs narrated decks. Both pins were
  rendered at identical settings, the noise floor was measured at 0.8.27 for
  comparison, 28 of 29 predicted candidate frames were checked individually, and
  four of the differences were looked at rather than inferred. The gap the
  previous version told a reviewer to weigh is closed.
- **High** that the last frame of an off-grid deck renders blank at 0.8.31. It
  was predicted from the predicate before the render and the frame is on disk.
- **Medium** that 0.8.31's `fontWeight` behaviour is an improvement rather than a
  regression. The ramp shape says so and both pins are self-reproducible, so the
  measurement is solid; the reading of it is one inference from one instrument.
- **Low** on anything about 0.8.32 and 0.8.33, which is to say: nothing is
  claimed about them.
