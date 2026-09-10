# hyperframes 0.8.27 → 0.8.33

Issue #70. Two rounds of measurement, in one worktree at
`~/.blackhole/DeckSmith/2026-09-09/hf-pin`, branch `chore/hyperframes-0.8.31`:

| | when | what |
| --- | --- | --- |
| **Part one**, §1–§7b | 2026-09-09 and 2026-09-10 | 0.8.27 → 0.8.31, and the two caveats that round left open |
| **Part two**, §A–§F | 2026-09-10 | 0.8.31 → 0.8.33, because the registry had already moved past 0.8.31 |

**Verdict: pin 0.8.33, not 0.8.31.** Not merely because it is `latest` and
`upstream-drift.yml` would otherwise re-file this issue on Monday, though it
would. The substantive reason is that **0.8.32 reverses the one behavioural
change part one measured as the cost of taking 0.8.31.** The element-activation
window stops being floored to the frame grid and starts being *snapped* to it
only when it is already within 0.001 of a frame. Every consequence part one
paid for — the outgoing scene torn down one frame early, the incoming scene's
furniture painted one frame early, and **the blank last frame** — is gone at
0.8.33, verified frame by frame on the fixture that was built to see it. On
that fixture 0.8.33 is not merely close to 0.8.27, it is **byte-identical to it
across all 213 frames**.

What taking 0.8.33 costs instead is **eleven new gate warnings on the demo
deck** (9 → 20), from three lint and layout rules 0.8.32 adds. None is an error,
the verdict stays `PASS`, and at least one of them points at a real visible
defect nothing in this repo could see before.

Part one's own conclusions are left standing, unedited, because they are the
record of what 0.8.31 does and every figure in them was taken from the command
printed beside it. Where part two supersedes one, it says so.

---

# Part one — 0.8.27 → 0.8.31

*Everything in §1–§7b is about 0.8.31, and is the record of what that
release does. It is left as it was written. Part two supersedes §9 and
§10, and adds to §8.*

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
issue re-files next Monday regardless of what we do here. *(Resolved 2026-09-10:
the pin went to 0.8.33 instead — part two. The declared and installed versions
and `npx hyperframes --version` all read 0.8.33, and the lockfile diff is again
the `hyperframes` entry alone, with no transitive bump.)*

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

**Read the `totalIssueCount` line with care.** On 2026-09-10 that count was
measured twice at one pin, on one deck, minutes apart, and came back 24 then 23
— it is dominated by `content_overlap`, which is not reproducible run to run
(§E). Two equal counts at two pins are therefore weaker evidence than this
paragraph implies. The `ok`, the error count and the contrast figures are
stable; the issue total is not.

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

---

# Part two — 0.8.31 → 0.8.33

Measured 2026-09-10, same worktree, same deck sources. Part one's §8 closed with
"**0.8.32 and 0.8.33 were not examined at all.**" This is that.

Predictions were written to
`~/.blackhole/DeckSmith/2026-09-10/predictions/2026-09-10-predictions-0.8.33.txt`
after the decompile and **before the pin was moved or any instrument was run**.
They are reported below unadjusted, including the two that failed.

## A. The tarballs, and that they are the ones npm installs

`npm pack` for each version, then checked against the registry's own metadata —
not against each other, and not on npm's word alone:

| | `npm view … dist.shasum` | local sha1 of the .tgz | agrees |
| --- | --- | --- | --- |
| 0.8.31 | `860692e40aeefb3b2bd6e67ff0f62524824ae415` | same | yes |
| 0.8.32 | `176bb3a185a68ccaa3128af6509ccdfbb0c8d28f` | same | yes |
| 0.8.33 | `1d8531622a1773b9b6f90220875e5c27f9bdcd90` | same | yes |

The sha512 `dist.integrity` values agree too. And the tarball is what was on
disk: **all 86 files of the installed 0.8.31 tree are byte-identical to the
0.8.31 tarball**, and after the bump the installed 0.8.33 runtime
(`696c9c6ff46c173d…`) and `cli.js` (`af57f08331c602ce…`) match the 0.8.33
tarball exactly.

`npm view hyperframes dist-tags` → `latest: 0.8.33`. Published 2026-09-08T23:49Z
(0.8.32) and 2026-09-09T02:21Z (0.8.33), 31 hours and 34 hours after 0.8.31.

Which files move:

| | files changed | of note |
| --- | --- | --- |
| 0.8.31 → 0.8.32 | 14 | `cli.js`, **`hyperframe.runtime.iife.js`**, `layout-audit.browser.js`, the player, studio |
| 0.8.32 → 0.8.33 | 5 | `cli.js`, `fontLocalizeCli.js`, the player's version string, studio, `package.json` |

**The render runtime is byte-identical at 0.8.32 and 0.8.33** (399 774 B, same
sha256). So everything that reaches `hyperframes render` changes exactly once
across this bump, at 0.8.32.

## B. The one change that reaches the renderer, and it is a reversal

Part one, §2, found that 0.8.31 added two call sites to the frame-grid
quantiser — the element-activation window — and that they *floor*:

```js
// 0.8.31, runtime line 13965
$  = window.__HF_EXPORT_RENDER_SEEK_CONFIG ? mt(w, e.canonicalFps) : w,
ue = window.__HF_EXPORT_RENDER_SEEK_CONFIG && Number.isFinite(re) ? mt(re, e.canonicalFps) : re;
return g >= $ && (Number.isFinite(ue) ? g < ue : !0);

function mt(e, t) {                                  // e = time, t = fps
  let n = Number.isFinite(t) && t > 0 ? t : 30,
      r = Number.isFinite(e) && e > 0 ? e : 0;
  return Math.floor(r * n + 1e-9) / n;               // FLOOR, unconditionally
}
```

At 0.8.32 the predicate is character-for-character the same except for the
function it calls, and the function it calls is new:

```js
// 0.8.32 and 0.8.33, runtime line 13990 — the only edit is mt -> Bo
$  = window.__HF_EXPORT_RENDER_SEEK_CONFIG ? Bo(w, e.canonicalFps) : w,
ue = window.__HF_EXPORT_RENDER_SEEK_CONFIG && Number.isFinite(re) ? Bo(re, e.canonicalFps) : re;

function Bo(e, t) {
  let n = Number.isFinite(t) && t > 0 ? t : 30,
      r = Number.isFinite(e) && e > 0 ? e : 0,
      i = r * n,                                     // the time in frames
      o = Math.round(i);                             // the nearest whole frame
  return Math.abs(i - o) <= 0.001 ? o / n : r;       // SNAP if within 0.001 frame, else leave alone
}
```

The old floor survives under a new name (`$t`) and keeps its five *seek*-time
call sites, unchanged. Only the activation window moved.

**The tolerance is 0.001 of a frame — 33 microseconds at 30 fps.** That is far
too tight for any authored time to reach: DeckSmith rounds times to three
decimals (invariant 10), so a boundary at 3.417 s is 102.51 frames, 0.49 of a
frame from the grid, and `Bo` hands it straight back. It is wide enough only for
float drift. So `Bo` is not a coarser floor or a finer one — it is a
*float-drift corrector*, and on every real boundary value it is the identity.

Which means **0.8.32 restores 0.8.27's arithmetic** on any boundary that is
genuinely off the grid, and improves on it on any boundary that is on the grid
but arrived there through floating-point addition. §D measures exactly that.

## C. What else changed, and whether it can reach DeckSmith

Three more things move. Each is answered by grep, which is the cheapest evidence
available and the same method §2 used to retire two of 0.8.31's three changes.

**1. `data-hf-media-start-basis`** (0.8.32). Media start resolution stops
guessing. At 0.8.31, a `<video>`/`<audio>` carrying `data-start` inside a
composition whose own start is > 0 got a heuristic — `y >= h && (N == null ||
y < N) ? y : h + y` — that decided for itself whether the authored value was
global or host-relative. At 0.8.32 the guess is replaced by an attribute that
defaults to local:

```js
Pf(e) { return Ay(e.basis) === "global" ? e.authoredStart : e.hostStart + e.authoredStart; }
```

**Cannot reach DeckSmith.** The branch is gated on `tagName` being `video` or
`audio`, and the built `index.html` — the only file `hyperframes render` loads —
contains **zero** `<video>` or `<audio>` tags. The one `<video>` DeckSmith can
emit (`src/emit/archetypes/claim-figure.ts:183`) is not in this deck, and the
narration audio is built by JS at `src/deck/runtime.ts:566` with no `data-start`.
The paired lint rule `nested_media_start_basis_ambiguous` is additionally gated
on `ctx.options.isSubComposition`, which this deck is not.

**2. Two lines in `cli.js` at 0.8.33** — the entire behavioural delta of that
release, and both are in the static-frame dedup path:

```js
// computeStaticFrameSet(), walk(): a timeline that drives state from a callback
// now marks its whole span non-static, so dedup will not collapse it
if (typeof tl.vars?.onUpdate === "function") {
  const total = typeof tl.totalDuration === "function" ? tl.totalDuration() : 0;
  if (total > 0) intervals2.push({ start: offset2, end: offset2 + total });
}

// the static-verify seek stops hiding callback-driven motion from itself
- if (hf && typeof hf.seek === "function") hf.seek(tt3, { suppressEvents: true });
+ if (hf && typeof hf.seek === "function") hf.seek(tt3, { suppressEvents: false });
```

This is upstream arriving, independently, at **AGENTS.md invariant 11**: a
timeline whose only effect is an `onUpdate` produces no tween intervals, so the
dedup optimiser used to conclude its frames were static and duplicate them.
DeckSmith forbids `onUpdate` outright, so the first line is inert here by
construction; the second changes what the verifier captures on any deck. It is
worth recording because it is the first upstream acknowledgement that
`suppressEvents` on a verification seek shows the verifier something the render
does not — which is precisely what AGENTS.md's "three views of one instant
disagree three ways" note is about.

**3. Seven new gate rules** (0.8.32), no removals. The first enumeration of
these missed one: counting `code: "…"` literals in `cli.js` found six, but
`connector_orphan` is emitted from `layout-audit.browser.js`, which grew
74 319 → 80 787 B in the same release. Enumerating every new snake_case literal
across `cli.js`, `layout-audit.browser.js` and the runtime finds all seven.

| rule | severity | can it reach DeckSmith? |
| --- | --- | --- |
| `runtime_hidden_style_opacity` | **error** | **No.** Needs a CSS selector matching `[style*="…visibility: hidden…"]` not scoped to `data-composition-src`/`-file`. `grep -rn 'style\*=' src/ demo/ scripts/` — no matches; 0 in the built `index.html`. |
| `unbalanced_style_tags` | **error** | **No.** The built `index.html` has 1 `<style>` and 1 `</style>`. |
| `gsap_repeated_fromto_without_baseline` | warning | **Yes — 9 findings.** See §E. |
| `gsap_undefined_css_variable` | warning | **No.** No `var()` appears in any GSAP colour value in the deck. |
| `media_runtime_src_mutation` | warning | **No.** 0 `.src =` assignments and 0 `setAttribute("src", …)` in the deck. |
| `nested_media_start_basis_ambiguous` | warning | **No.** Gated on `isSubComposition`, and there is no `<video>`/`<audio>` at all. |
| `connector_orphan` | info (upstream) | **Yes — 1 finding**, regraded to warning by DeckSmith. See §E. |

Both new **error** rules are unreachable, which is why the verdict does not
change. Four of the five new warnings are unreachable too. The two that fire are
the whole of the gate delta.

## D. The off-grid fixture — the instrument built to see this

Part one's §7 built a two-beat, no-narration fixture off `plain` whose duration
is 7.068 s and whose element windows are `root [0, 7.068]`, `s1 [0, 3.417]`,
`s2 [3.017, 7.068]` — three boundary values off the 1/30 grid. It was authored
to be zero-noise, and it is: two renders at one pin come back byte-identical.

**All four sequences below were rendered on 2026-09-10 from one deck directory
with one command**, `npx hyperframes render <deck> --format png-sequence -o <dir>
-w 1`, flipping only the pin between them. That control matters more than usual;
see the caveat below.

| | frames | identical | differing |
| --- | --- | --- | --- |
| 0.8.33 vs 0.8.33 (two renders — the noise floor) | 213 | **213** | 0 |
| **0.8.33 vs 0.8.27** | 213 | **213** | **0** |
| 0.8.33 vs 0.8.31 | 213 | 211 | **2** — frames 103 and 213 |
| 0.8.31 vs 0.8.27 (part one's row, re-taken today) | 213 | 211 | 2 — frames 103 and 213 |

**0.8.33 renders this fixture byte-identically to 0.8.27, all 213 frames.** Not
"below the noise floor" — the same bytes. With a zero-noise instrument that is
the strongest available statement, and it is exactly what §B's arithmetic
predicts: none of the three off-grid boundaries is within 0.001 of a frame, so
`Bo` returns each unchanged and the predicate is 0.8.27's.

The two frames 0.8.31 moved, move back — 14.48 dB and 10.22 dB apart from
0.8.31 — and they were looked at, not inferred
(`~/.blackhole/DeckSmith/2026-09-10/frames33/`, 0.8.31 left of the yellow rule):

- **Frame 103** (`sbs-offgrid-103-31L-33R.png`), scene `s1`'s end boundary. At
  0.8.31 `s1` is already gone — "Two renders, one hash", its rule and its
  footnote all torn down mid-crossfade, leaving only `s2`'s eyebrow and
  headline. At 0.8.33 `s1` is still there, fading, as at 0.8.27.
- **Frame 213** (`sbs-offgrid-213-31L-33R.png`), the last frame of the video.
  **At 0.8.31 it is blank — a black rectangle.** At 0.8.33 it is the closing
  slide, complete.

That second one is part one's §7b finding reproducing on a 7-second fixture:
`root:end` and the last scene's end are the same off-grid value, both floor to
the previous frame, and the whole composition is torn down on the frame the
renderer seeks to. It is why part one recommended snapping composition duration
to a whole frame. **0.8.33 removes the need.**

### A caveat that nearly produced a false alarm

The first comparison run today put a fresh 0.8.33 render against the 0.8.27 and
0.8.31 sequences kept from 2026-09-09 and reported **206 of 213 frames
differing**. That is not a pin effect. Re-rendering all three pins today, with
one command, collapses it to the table above; and comparing 0.8.27-today against
0.8.27-yesterday — same pin, same deck — reproduces the same 206 frames at
38–50 dB. A difference map localises every one of them to **a single line of
small text**, rasterised differently between the two days. Everything else in
the frame is identical.

So: **PNG sequences of this fixture are comparable within a day and not across
days.** Part one's 213/213 rows are sound; they were taken within one day. Any
future use of this instrument has to re-render its own control, and this is the
second time in two days that comparing against a baseline captured under
different conditions produced a number that bounded nothing.

## E. The cheap instruments

All run 2026-09-10, all on the same deck built that day, and — where a
comparison is made — with the control re-taken the same day.

### Build output

34 files in the built deck tree. **Exactly one differs across all three pins**:
`hyperframes-player.global.js`. `index.html` (96 416 B), `deck.html`,
`timing.json`, `gsap.min.js`, `katex.min.js`, `DrawSVGPlugin.min.js` and
`ds-morph.js` are byte-identical at 0.8.27, 0.8.31 and 0.8.33.

**But the player is no longer only a version string, and the prediction that it
would be was wrong.** It goes 64 037 → 64 164 B at 0.8.32, and the 127 bytes are
four lines of CSS:

```css
.hfp-shader-loader:not(.hfp-visible):not(.hfp-hiding) .hfp-shader-loader-title-text {
  animation-play-state: paused;
}
```

Inert at render time — `index.html` contains **zero** references to
`hyperframes-player`, so the file `hyperframes render` loads never sees it; only
`deck.html` does — and inert in the player too, since `.hfp-shader-loader` is
player chrome DeckSmith never styles.
Recorded because "exactly one vendored file changes, and only in a URL" was a
standing claim and it has now expired.

### `scripts/seek-probe.mjs`

The host-bridge path, the one a deck consumer actually drives.

| | stops | island agrees | transitions | moved | still | scenes | ever moved | fingerprints | page errors | pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.8.27 | 46 | yes | 45 | 45 | none | 16 | 16 | 46 | 0 | true |
| 0.8.31 | 46 | yes | 45 | 45 | none | 16 | 16 | 46 | 0 | true |
| 0.8.33 | 46 | yes | 45 | 45 | none | 16 | 16 | 46 | 0 | true |

Stronger than the table: with the deck path and the version string normalised,
**the three JSON documents are identical** — every stop label, every transition
fingerprint, all of it. The step layer is untouched by both bumps.

### `hyperframes check --json`, and a number that is not reproducible

Run on one deck directory, at all three pins, today:

| | ok | errors | warnings | infos |
| --- | --- | --- | --- | --- |
| 0.8.27 | true | 0 | 10 | 14 |
| 0.8.31 | true | 0 | 10 | 13 |
| 0.8.33 | true | 0 | 19 | 17 |

**`ok: true` and zero errors at 0.8.33**, which is what §C's reachability greps
predicted and the thing the gate actually turns on.

Findings at 0.8.33, by code: `content_overlap` 24,
`gsap_repeated_fromto_without_baseline` 9, `composition_file_too_large` 1,
`connector_detached` 1, `connector_orphan` 1.

**`content_overlap` is not reproducible run to run.** Two `check` runs at
0.8.33, same binary, same deck, minutes apart, returned 24 and 23. So the 22/23/24
spread across the three pins above is jitter and **not attributable to the
bump** — and part one's §5, which compared `totalIssueCount: 23` against
`totalIssueCount: 23` as though it were a stable number, was reading a number
that moves on its own. That comparison should not be repeated without running
the same pin twice first.

### The build verdict — the number that actually changed

Same day, same storyboard, same source, `--no-narration`:

| | verdict |
| --- | --- |
| 0.8.31 | `PASS — 0 error(s), 9 warning(s)` |
| 0.8.33 | `PASS — 0 error(s), 20 warning(s)` |

| rule | gate | 0.8.31 | 0.8.33 |
| --- | --- | --- | --- |
| `content_overlap` | layout | 9 warning + 14 info | 9 warning + 14 info |
| `composition_file_too_large` | lint | 1 info | 1 info |
| `gsap_repeated_fromto_without_baseline` | lint | — | **9 warning** |
| `connector_orphan` | layout | — | **1 warning** |
| `connector_detached` | layout | — | **1 warning** |

(An earlier build the same morning printed 21, one more `content_overlap`. Same
jitter.)

**The nine.** Upstream's rule groups `tl.fromTo()` windows by literal target,
drops any carrying `immediateRender: false`, and reports every selector left
holding two or more with no earlier `tl.set()` baseline. Modelled against that
code before the pin moved, the deck has 0 `tl.set()` calls, 0 unresolved
targets, 138 eligible windows and **exactly 9** selectors with two or more:
`#s3-pulse0`, `#s3-pulse1`, `#s3-pulse2`, `#s6 .t-a`, `#s6 .t-b`, `#s7-morph`,
`#s8-probe`, `#s12-ring`, `#s13-divhi`. Measured: 9. The rule is describing
something true about this deck — the last-authored `fromTo`'s *from* values are
what those elements rest at before their first tween runs — and it is a
reasonable thing to want to know.

**The connector pair, looked at rather than trusted.** Both point at `#s3-loop`
at t=22.333 s: *"Connector shaft is visible while both endpoints are not on
stage"* and *"Connector path endpoints render 380px from the nearest anchorable
element — a marked shaft that meets no node."* Photographed with
`decksmith frames --at 22.333`
(`~/.blackhole/DeckSmith/2026-09-10/frames33/connector-crop.png`): below the
DQ-CTM box, in empty space, **a lone amber glyph — the tail of the loop's label
— hangs with nothing around it**, its shaft meeting no node. It is a real defect
on the demo deck, visible to the eye, and neither 0.8.27 nor 0.8.31 could see
it. Upstream promotes these at `info`; DeckSmith's own grading raises them to
`warning`, which is the finding-severity coupling part one's §5 flagged, working
as intended for once.

Note the instrument: `decksmith frames` passes `suppressEvents`, so that PNG is
what the **gate** saw. That is the right view here, because the gate is the
thing that changed.

### The DeckSmith gates

Run in the order `build` → `check` → `sweep`, because `check` does not build.

| gate | result |
| --- | --- |
| `npm run build` | exit 0 |
| `npm run check` (first run) | **exit 1** — 46 files, 1602 tests, 1601 passing |
| `npm run sweep` | exit 0 — 45 ok, 8 refused over 53 cells in 65.7 s |
| `npm run check` (second run) | exit 0 — 46 files, 1602 tests, all passing |

The single red test is `experiments/sweep/swept.test.mjs`, holding
`d55f243c08d3036b` against a computed `f42f5dc042ec429b` — `toolFingerprint()`
folding `package.json`'s dependencies into its hash, exactly as at 0.8.31. It is
the receipt working, and re-earning it is a step every pin bump needs.

What the re-run proves is worth more than the tick: **the ledger diff is two
lines, `tool` and `updated`.** All 53 cell verdicts and all 11 corpus entries are
byte-identical to the 0.8.31 ledger — 11/11 known defects still fixed, 0 still
open, 42 other cells undefective.

## F. Predictions, unadjusted

Written before the pin moved, to
`~/.blackhole/DeckSmith/2026-09-10/predictions/2026-09-10-predictions-0.8.33.txt`.

| | prediction | measured | held |
| --- | --- | --- | --- |
| P1 | off-grid fixture, 0.8.33 vs 0.8.27: **zero** differing frames | 213 of 213 byte-identical | **yes** |
| P2 | 0.8.33 vs 0.8.31: the same 2 frames, moved back | frames 103 and 213, and the 0.8.33 render is byte-identical to 0.8.27's | **yes** |
| P3 | seek-probe: identical row at all three pins | identical JSON, not just an identical row | **yes** |
| P4 | `check`: `ok: true`, 0 errors; warnings 9 → 18, **all** from `gsap_repeated_fromto_without_baseline` | `ok: true`, 0 errors, and exactly 9 of that rule — but warnings went 9 → **20**, because two `connector_*` findings were not anticipated | **no** |
| P5 | one vendored file differs, **only** in its jsDelivr version string | one file differs, but it also gained four lines of CSS: 64 037 → 64 164 B | **no** |
| P6 | build 0; check exit 1 on the sweep receipt alone; sweep 45/8 over 53; ledger diff two lines; check 0 after | exactly that, all of it | **yes** |
| P7 | the narrated deck's blank last frame is gone at 0.8.33 | **not measured on the narrated deck.** The mechanism reverting is measured on the fixture, whose last frame goes from blank to complete | untested |
| P8 | *(deliberately unpredicted)* whether the silent deck's 8 `fontWeight` frames revert | not measured | — |

**P4's failure is the useful one.** The rule-count model was exactly right — 9,
by name — and the failure was in believing the enumeration of new rules was
complete. It was not: `connector_orphan` lives in `layout-audit.browser.js`, not
`cli.js`, and grepping one bundle for `code: "…"` missed it. The corrected method
is in §C: enumerate every new snake_case literal across all three bundles.

**P5's failure cost nothing and is worth keeping** because "exactly one vendored
file changes, and only in a URL" had hardened into a rule of thumb after two
bumps. It survived a third bump only in its first half.

---

## 8. Not measured

Recorded as explicitly as the measurements. Struck-through entries were closed
by a later round; the rest are open.

Closed:

- ~~The full-length cross-pin comparison of the demo deck did not run.~~
  **Closed 2026-09-10 — §7a.** Not by PNG sequence, which does not fit (~33 GB
  silent, ~66 GB narrated, against ~18 GB free), but mp4-to-mp4 through ffmpeg's
  `psnr` filter. The cost of that substitution is stated where it bites: H.264
  rate-control divergence inflates the differing-frame count by roughly 40×.
- ~~The 0.8.31 noise floor for the demo deck.~~ **Closed — §7a.** Zero at both
  pins at `-w 1`.
- ~~The narrated deck was not rendered at either pin.~~ **Closed — §7b.**
- ~~The mp4 comparison is confounded.~~ **Closed — §7½.** Both sides `-w 1`,
  same streaming-encode gate.
- ~~0.8.32 and 0.8.33 were not examined at all.~~ **Closed 2026-09-10 —
  part two.** Both decompiled against the installed 0.8.31, tarballs verified
  against the registry, and 0.8.33 taken.

Open, and each one names what would close it:

- **The narrated deck was NOT rendered at 0.8.33.** Part two skipped it
  deliberately: the disk was at 18 GB, the narrated render costs two 4m26s
  captures, and the cheap instruments had already answered the question — the
  activation predicate is arithmetically 0.8.27's again, and the fixture shows
  the blank last frame gone. But **P7 is an inference, not a measurement.** The
  frame that would settle it is 7974. Two `-w 1` renders with
  `PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS=600` and one `ffmpeg -lavfi
  psnr` would do it in about forty minutes and 200 MB.
- **The silent demo deck was not rendered at 0.8.33 either**, so §7a's eight
  `fontWeight` frames have no 0.8.33 row. Two `-w 1` renders, about six minutes.
- **Why the silent deck differs across 0.8.27 → 0.8.31 at all is still NOT
  MEASURED.** §7a localises it to those eight frames and shows 0.8.31's ramp is
  the continuous one; no bisect across 0.8.28/0.8.29/0.8.30 was run and no
  upstream code path was identified. Part two did not look for it, because the
  runtime diff it read was 0.8.31 → 0.8.32 and the cause is earlier than that.
- **Nobody has watched any deck end to end at any pin.** Eight frames have now
  been inspected side by side across the three rounds — six from part one, plus
  the fixture's 103 and 213 — and one gate frame at t=22.333 s. That is sampling.
- **The narrated deck's audio and subtitles were never compared across any pin.**
  Only the video stream. Two 0.8.27 narrated mp4s are not byte-identical while
  their video streams differ only above 60 dB, so something in the AAC encode or
  the container is itself non-reproducible.
- **`media_src_kind_mismatch` against a real clip**, and now also
  `data-hf-media-start-basis` against a real `<video data-start>`. Both are
  answered statically (§2, §C) and neither is exercised, because no `.mp4`/
  `.webm` fixture exists in the repo.
- **`content_overlap`'s own reproducibility was measured only twice** (24, then
  23). Two runs establish that it moves; they do not establish its spread. Any
  future claim that a bump changed the layout finding count needs the same pin
  run several times first.
- **The two new ERROR rules are unreachable on this deck, not on every deck.**
  `runtime_hidden_style_opacity` and `unbalanced_style_tags` were retired by
  grepping *this* repo's emitters. A future archetype that emits a
  `[style*="visibility: hidden"]` guard, or a template that unbalances a
  `<style>`, would fail `check` at error severity with no warning shot.
- **`demo/deck-control/` and `demo/deck-new/` are untracked build output** left
  in the worktree as part one's baselines, and `demo/audio/` was copied in on
  2026-09-10 and is gitignored. An unrelated `git add -A` would sweep the first
  two in.

## 9. Recommendation

**Pin 0.8.33.**

It is `latest`, so it is the only value that stops `upstream-drift.yml`
re-filing #70 next Monday — but that is the weaker half of the reason. The
stronger half is that **0.8.32 undoes the cost part one measured.** Everything
that made taking 0.8.31 a trade rather than a free upgrade came from one
predicate flooring the element-activation window; 0.8.32 replaces the floor with
a 0.001-frame snap that is the identity on every authored boundary. On the
fixture built to see that change, 0.8.33 and 0.8.27 are byte-identical across all
213 frames, and the blank last frame — the one behaviour a viewer would actually
have noticed — is gone.

What it costs instead is **eleven gate warnings on the demo deck, 9 → 20**, none
of them an error, from three rules 0.8.32 adds. Two of those findings point at a
genuine visible defect (§E). Nine of them are a fair description of how this deck
uses `fromTo`. Neither is a reason to hold the bump; both are reasons to expect
the gate output to look different on Monday.

Then, separately and not as conditions of this bump — the list part one left,
minus what 0.8.33 already fixed:

1. **A browser-free arithmetic test** asserting `src/render/timing.ts`'s
   `Math.round` grid against the runtime's quantiser. Still the only guard here
   that would have caught 0.8.30 before a render ran — and it would now have to
   assert against `Bo`, not `mt`, which is itself the argument for writing it:
   the thing it guards has already changed twice in six versions.
2. **A guard on the finding-selector coupling** in `src/verify/check.ts:364` and
   `scripts/sweep.mjs:436`, both of which parse a scene id out of a string
   upstream is free to reformat — and did at 0.8.31.
3. **Rewrite the "two renders byte-identical" requirement at its source** in
   `.github/workflows/upstream-drift.yml`. It is regenerated every Monday, it has
   been wrong since 2026-09-04, and editing the issue does not fix it. Do not
   change the issue title or it files a duplicate.
4. **A clip fixture**, so the one `<video>` DeckSmith can emit is exercised by
   something the repo owns. Two rules now depend on it (§8).
5. ~~**Snap the composition's total duration to a whole frame.**~~ **0.8.33
   removes the need.** It is still defensible on its own merits — an off-grid
   total duration is an odd thing to ship — but it is no longer a fix for
   anything observed.
6. **Keep the cross-pin fixture check, and make it re-render its own control.**
   Four `-w 1` renders of the 213-frame fixture cost about a minute and 70 MB,
   and the instrument has no noise floor to subtract. The one rule it needs is
   §D's: **never compare against a sequence captured on another day.**
7. **Bisect 0.8.28 / 0.8.29 / 0.8.30 for the `fontWeight` change** in §7a. Three
   renders. Until then the silent deck's eight moved frames have a measurement
   and no cause — and no 0.8.33 row either.
8. **Enumerate upstream rules across every bundle, not just `cli.js`.** §C's
   first pass missed `connector_orphan` and the prediction built on it failed.
   The working method is: diff the set of snake_case string literals across
   `cli.js`, `commands/layout-audit.browser.js` and `hyperframe.runtime.iife.js`.

## 10. Confidence

**High** on every number in both parts; each was taken from the command printed
beside it, and where a figure was inherited from an earlier round it is named as
such.

On part one, unchanged from 2026-09-10's revision: high that the flooring change
is real and reaches the renderer; high that the demo deck is immune to it by
arithmetic but not immune to the 0.8.27 → 0.8.31 bump; high on what it costs
narrated decks; medium that 0.8.31's `fontWeight` behaviour is an improvement.

On part two:

- **High** that 0.8.32 replaces the floor with a near-grid snap and that this is
  the only change reaching `hyperframes render` across 0.8.31 → 0.8.33. Read out
  of the decompiled runtime, confirmed by call-site enumeration, and confirmed
  again by the runtime being byte-identical at 0.8.32 and 0.8.33.
- **High** that 0.8.33 renders the off-grid fixture byte-identically to 0.8.27.
  It is 213 of 213 byte-identical hashes with a zero-noise instrument, all four
  sequences captured the same day with one command.
- **High** that the gates stay green and that the two new error-severity rules
  cannot fire on this deck. Both were retired by grep, and both greps were run
  against the emitters and the built artefact.
- **Medium-high** that the blank last frame is gone on the *narrated* deck. The
  arithmetic is unambiguous and the fixture reproduces the whole mechanism at
  213 frames — but the narrated deck was not rendered at 0.8.33, and part one is
  a standing reminder that this project's predictions about which frames move
  have been wrong twice while being right about the mechanism.
- **Medium** on the *severity* of the eleven new warnings. `ok: true` and zero
  errors is measured and certain. Whether nine `gsap_repeated_fromto_without_
  baseline` findings are worth acting on, or worth suppressing, is a judgement
  nobody has made yet, and the rule is one release old.
- **Low**, which is to say nothing is claimed, about 0.8.34 and later.
